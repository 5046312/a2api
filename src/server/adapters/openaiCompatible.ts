import { fetchJson, mergeCustomHeaders, normalizeBaseUrl, resolveOpenAiPath } from '../shared/http.js';
import type { ApiTokenInfo, AuthenticatedInput, BalanceInfo, ModelDiscoveryInput, ModelInfo, PlatformAdapter, UpstreamPlatform, VerifyTokenInput } from './types.js';

type ModelsPayload = {
  data?: Array<{
    id?: string;
    root?: string;
    context_length?: number;
    contextLength?: number;
  }>;
};

type NewApiUserPayload = {
  success?: boolean;
  data?: {
    quota?: number;
    used_quota?: number;
  };
  quota?: number;
  used_quota?: number;
};

type Sub2ApiAuthMePayload = {
  data?: {
    balance?: number | string;
  };
  balance?: number | string;
};

type TokenListPayload = {
  data?: unknown;
  items?: unknown;
  list?: unknown;
};

export class OpenAiCompatibleAdapter implements PlatformAdapter {
  readonly platformName: UpstreamPlatform;

  constructor(platformName: UpstreamPlatform) {
    this.platformName = platformName;
  }

  async detect(url: string): Promise<boolean> {
    const normalized = normalizeBaseUrl(url);
    if (this.platformName === 'openai') return normalized.includes('openai.com');
    if (this.platformName === 'sub2api') return normalized.includes('sub2api');
    if (this.platformName === 'new-api' || this.platformName === 'one-api') {
      return normalized.includes('new-api') || normalized.includes('one-api') || normalized.includes('oneapi');
    }
    return false;
  }

  async verifyToken(input: VerifyTokenInput) {
    const discoveryInput: ModelDiscoveryInput = {
      accountId: input.accountId,
      baseUrl: input.baseUrl,
      platform: input.platform,
      token: input.token,
      credentialMode: 'apikey'
    };
    if (input.proxyUrl !== undefined) discoveryInput.proxyUrl = input.proxyUrl;
    if (input.customHeaders !== undefined) discoveryInput.customHeaders = input.customHeaders;

    const models = await this.getModels(discoveryInput);
    return {
      tokenType: models.length > 0 ? 'apikey' as const : 'unknown' as const,
      userInfo: null,
      balance: null,
      apiToken: input.token,
      models
    };
  }

  async getModels(input: ModelDiscoveryInput): Promise<ModelInfo[]> {
    const url = resolveOpenAiPath(input.baseUrl, '/v1/models');
    const headers = mergeCustomHeaders({ Accept: 'application/json' }, input.customHeaders || null);
    const fetchOptions: Parameters<typeof fetchJson<ModelsPayload>>[1] = {
      token: input.token,
      headers
    };
    if (input.proxyUrl !== undefined) fetchOptions.proxyUrl = input.proxyUrl;
    const response = await fetchJson<ModelsPayload>(url, fetchOptions);
    const rows = Array.isArray(response.data.data) ? response.data.data : [];
    const seen = new Set<string>();
    const models: ModelInfo[] = [];

    for (const row of rows) {
      const name = (row.id || row.root || '').trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      models.push({
        name,
        contextLength: row.context_length ?? row.contextLength ?? null,
        raw: row
      });
    }

    return models;
  }

  async getBalance(input: AuthenticatedInput): Promise<BalanceInfo | null> {
    if (input.platform === 'openai') return null;
    const token = input.accessToken || input.apiToken;
    if (!token) return null;

    if (input.platform === 'sub2api') {
      return this.getSub2ApiBalance(input, token);
    }
    return this.getNewApiBalance(input, token);
  }

  async getApiTokens(input: AuthenticatedInput): Promise<ApiTokenInfo[]> {
    if (!supportsTokenList(input.platform)) return [];
    const token = input.accessToken || input.apiToken;
    if (!token) return [];

    const url = `${normalizeBaseUrl(input.baseUrl)}/api/token/?p=0&size=100`;
    const headers = mergeCustomHeaders({ Accept: 'application/json' }, input.customHeaders || null);
    const fetchOptions: Parameters<typeof fetchJson<TokenListPayload>>[1] = {
      token,
      headers
    };
    if (input.proxyUrl !== undefined) fetchOptions.proxyUrl = input.proxyUrl;

    const response = await fetchJson<TokenListPayload>(url, fetchOptions);
    return tokenItemsFromPayload(response.data).map(tokenInfoFromItem).filter((item): item is ApiTokenInfo => !!item);
  }

  private async getNewApiBalance(input: AuthenticatedInput, token: string): Promise<BalanceInfo> {
    const url = `${normalizeBaseUrl(input.baseUrl)}/api/user/self`;
    const headers = mergeCustomHeaders({ Accept: 'application/json' }, input.customHeaders || null);
    const fetchOptions: Parameters<typeof fetchJson<NewApiUserPayload>>[1] = {
      token,
      headers
    };
    if (input.proxyUrl !== undefined) fetchOptions.proxyUrl = input.proxyUrl;
    const response = await fetchJson<NewApiUserPayload>(url, fetchOptions);
    const data = response.data.data || response.data;
    const balance = quotaUnitToUsd(data.quota);
    const used = quotaUnitToUsd(data.used_quota);
    return { balance, used, quota: balance + used };
  }

  private async getSub2ApiBalance(input: AuthenticatedInput, token: string): Promise<BalanceInfo> {
    const url = `${normalizeBaseUrl(input.baseUrl)}/api/v1/auth/me`;
    const headers = mergeCustomHeaders({ Accept: 'application/json' }, input.customHeaders || null);
    const fetchOptions: Parameters<typeof fetchJson<Sub2ApiAuthMePayload>>[1] = {
      token,
      headers
    };
    if (input.proxyUrl !== undefined) fetchOptions.proxyUrl = input.proxyUrl;
    const response = await fetchJson<Sub2ApiAuthMePayload>(url, fetchOptions);
    const data = response.data.data || response.data;
    const balance = numberFrom(data.balance);
    return { balance, used: 0, quota: balance };
  }
}

function quotaUnitToUsd(value: unknown): number {
  return numberFrom(value) / 500000;
}

function numberFrom(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringFrom(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numberStatusFrom(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function tokenItemsFromPayload(payload: TokenListPayload): unknown[] {
  if (Array.isArray(payload.data)) return payload.data;
  const data = asRecord(payload.data);
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.list)) return data.list;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.list)) return payload.list;
  return [];
}

function tokenInfoFromItem(item: unknown, index: number): ApiTokenInfo | null {
  const row = asRecord(item);
  if (!row) return null;

  const key = stringFrom(row.key);
  if (!key) return null;

  const name = stringFrom(row.name) || (index === 0 ? 'default' : `token-${index + 1}`);
  const group = stringFrom(row.group) || stringFrom(row.group_name) || stringFrom(row.token_group);
  const status = numberStatusFrom(row.status);
  const tokenInfo: ApiTokenInfo = {
    name,
    key,
    enabled: status === undefined ? true : status === 1
  };
  if (group) tokenInfo.tokenGroup = group;
  return tokenInfo;
}

function supportsTokenList(platform: UpstreamPlatform): boolean {
  return [
    'new-api',
    'one-api',
    'one-hub',
    'done-hub',
    'veloera',
    'anyrouter',
    'cliproxyapi',
    'sub2api'
  ].includes(platform);
}
