import { fetchJson, mergeCustomHeaders, normalizeBaseUrl, resolveOpenAiPath } from '../shared/http.js';
import { OpenAiCompatibleAdapter } from './openaiCompatible.js';
import type { ModelDiscoveryInput, ModelInfo, UpstreamPlatform } from './types.js';

type ModelsPayload = {
  data?: Array<{ id?: string; root?: string; context_length?: number; contextLength?: number }>;
};

type OneHubAvailableModelPayload = {
  data?: Record<string, unknown>;
};

export class OneHubAdapter extends OpenAiCompatibleAdapter {
  constructor() {
    super('one-hub');
  }

  async detect(url: string): Promise<boolean> {
    const normalized = url.toLowerCase();
    return /(?:^|[^a-z])one[-_ ]?hub(?:[^a-z]|$)/i.test(normalized);
  }

  async getModels(input: ModelDiscoveryInput): Promise<ModelInfo[]> {
    const models = await safeGetModels(() => super.getModels(input));
    if (models.length > 0) return models;

    const url = `${normalizeBaseUrl(input.baseUrl)}/api/available_model`;
    const fetchOptions: Parameters<typeof fetchJson<OneHubAvailableModelPayload>>[1] = {
      token: input.token,
      headers: mergeCustomHeaders({ Accept: 'application/json' }, input.customHeaders || null)
    };
    if (input.proxyUrl !== undefined) fetchOptions.proxyUrl = input.proxyUrl;
    const response = await fetchJson<OneHubAvailableModelPayload>(url, fetchOptions);
    const rows = response.data.data && typeof response.data.data === 'object' ? response.data.data : {};
    return Object.keys(rows).filter(Boolean).map((name) => ({ name }));
  }
}

export class DoneHubAdapter extends OpenAiCompatibleAdapter {
  constructor() {
    super('done-hub');
  }

  async detect(url: string): Promise<boolean> {
    const normalized = url.toLowerCase();
    return normalized.includes('donehub') || normalized.includes('done-hub');
  }
}

export class VeloeraAdapter extends OpenAiCompatibleAdapter {
  constructor() {
    super('veloera');
  }

  async detect(url: string): Promise<boolean> {
    return url.toLowerCase().includes('veloera');
  }
}

export class AnyRouterAdapter extends OpenAiCompatibleAdapter {
  constructor() {
    super('anyrouter');
  }

  async detect(url: string): Promise<boolean> {
    return url.toLowerCase().includes('anyrouter');
  }
}

export class CliProxyApiAdapter extends OpenAiCompatibleAdapter {
  constructor() {
    super('cliproxyapi');
  }

  async detect(url: string): Promise<boolean> {
    const normalized = url.toLowerCase();
    return normalized.includes('cliproxy') || normalized.includes('cli-proxy');
  }
}

export class ClaudeAdapter extends OpenAiCompatibleAdapter {
  constructor() {
    super('claude');
  }

  async detect(url: string): Promise<boolean> {
    const normalized = url.toLowerCase();
    return normalized.includes('api.anthropic.com') || normalized.includes('anthropic.com/v1') || normalized.endsWith('/anthropic');
  }

  async getModels(input: ModelDiscoveryInput): Promise<ModelInfo[]> {
    const claudeModels = await safeGetModels(() => this.getClaudeModels(input));
    if (claudeModels.length > 0) return claudeModels;
    const fallbackBaseUrl = openAiCompatibleFallbackBaseUrl(input.baseUrl);
    if (!fallbackBaseUrl) return claudeModels;
    return super.getModels({ ...input, baseUrl: fallbackBaseUrl, platform: 'openai' as UpstreamPlatform });
  }

  private async getClaudeModels(input: ModelDiscoveryInput): Promise<ModelInfo[]> {
    const fetchOptions: Parameters<typeof fetchJson<ModelsPayload>>[1] = {
      headers: mergeCustomHeaders({
        Accept: 'application/json',
        'x-api-key': input.token,
        'anthropic-version': '2023-06-01'
      }, input.customHeaders || null)
    };
    if (input.proxyUrl !== undefined) fetchOptions.proxyUrl = input.proxyUrl;
    const response = await fetchJson<ModelsPayload>(resolveOpenAiPath(input.baseUrl, '/v1/models'), fetchOptions);
    return modelsFromPayload(response.data);
  }
}

async function safeGetModels(loader: () => Promise<ModelInfo[]>): Promise<ModelInfo[]> {
  try {
    return await loader();
  } catch {
    return [];
  }
}

function openAiCompatibleFallbackBaseUrl(baseUrl: string): string | null {
  const normalized = normalizeBaseUrl(baseUrl);
  const match = normalized.match(/^(.*)\/anthropic$/i);
  return match?.[1] || null;
}

function modelsFromPayload(payload: ModelsPayload): ModelInfo[] {
  const rows = Array.isArray(payload.data) ? payload.data : [];
  const seen = new Set<string>();
  const output: ModelInfo[] = [];
  for (const row of rows) {
    const name = (row.id || row.root || '').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    output.push({
      name,
      contextLength: row.context_length ?? row.contextLength ?? null,
      raw: row
    });
  }
  return output;
}
