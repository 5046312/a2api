import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { parseJsonObject, stringifyJson } from '../shared/json.js';
import { nowIso } from '../shared/time.js';
import { refreshAccountBalance } from './balanceService.js';
import { rebuildRoutes } from './routeRefreshService.js';

export type OAuthProviderId = 'codex' | 'claude' | 'gemini-cli' | 'antigravity';

export type OAuthSessionState = 'pending' | 'success' | 'error';

export type OAuthSessionInfo = {
  state: string;
  provider: OAuthProviderId;
  status: OAuthSessionState;
  authorizationUrl: string;
  callbackPath: string;
  manualCallbackRequired: boolean;
  accountId: number | null;
  message: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
};

type OAuthSessionRecord = OAuthSessionInfo & {
  projectId: string | null;
  proxyUrl: string | null;
};

type ImportedOAuthCredential = {
  provider: OAuthProviderId;
  accessToken: string;
  refreshToken?: string | null;
  accountKey?: string | null;
  username?: string | null;
  email?: string | null;
  projectId?: string | null;
  proxyUrl?: string | null;
  providerData?: unknown;
};

const oauthSessions = new Map<string, OAuthSessionRecord>();

const providerDefaults: Record<OAuthProviderId, { label: string; url: string }> = {
  codex: { label: 'Codex OAuth', url: 'https://chatgpt.com/backend-api/codex' },
  claude: { label: 'Claude OAuth', url: 'https://api.anthropic.com' },
  'gemini-cli': { label: 'Gemini CLI OAuth', url: 'https://generativelanguage.googleapis.com' },
  antigravity: { label: 'Antigravity OAuth', url: 'https://daily-cloudcode-pa.googleapis.com' }
};

export function startOAuthSession(input: {
  provider: OAuthProviderId;
  projectId?: string | null;
  proxyUrl?: string | null;
  callbackBaseUrl?: string | null;
}): OAuthSessionInfo {
  const now = nowIso();
  const state = randomUUID();
  const callbackPath = `/api/oauth/callback/${input.provider}`;
  const authorizationUrl = buildAuthorizationUrl(input.provider, state, input.callbackBaseUrl, callbackPath);
  const record: OAuthSessionRecord = {
    state,
    provider: input.provider,
    status: 'pending',
    authorizationUrl,
    callbackPath,
    manualCallbackRequired: true,
    accountId: null,
    message: null,
    projectId: input.projectId?.trim() || null,
    proxyUrl: input.proxyUrl?.trim() || null,
    createdAt: now,
    updatedAt: now,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString()
  };
  oauthSessions.set(state, record);
  return toSessionInfo(record);
}

export function getOAuthSession(state: string): OAuthSessionInfo | null {
  const record = oauthSessions.get(state);
  return record ? toSessionInfo(record) : null;
}

export async function completeOAuthSessionFromCallback(state: string, callbackUrl: string): Promise<OAuthSessionInfo | null> {
  const record = oauthSessions.get(state);
  if (!record) return null;
  try {
    const credential = credentialFromCallbackUrl(record.provider, callbackUrl, record);
    const account = await upsertOAuthCredential(credential);
    await rebuildRoutes({ preserveManual: true });
    const next: OAuthSessionRecord = {
      ...record,
      status: 'success',
      accountId: account.id,
      message: 'OAuth 连接已导入',
      updatedAt: nowIso()
    };
    oauthSessions.set(state, next);
    return toSessionInfo(next);
  } catch (error) {
    const next: OAuthSessionRecord = {
      ...record,
      status: 'error',
      message: error instanceof Error ? error.message : 'OAuth callback 处理失败',
      updatedAt: nowIso()
    };
    oauthSessions.set(state, next);
    return toSessionInfo(next);
  }
}

export async function importOAuthCredentials(input: unknown) {
  const items = normalizeImportedCredentials(input);
  const importedAccountIds: number[] = [];
  for (const item of items) {
    const account = await upsertOAuthCredential(item);
    importedAccountIds.push(account.id);
  }
  if (importedAccountIds.length > 0) await rebuildRoutes({ preserveManual: true });
  return {
    ok: true,
    imported: importedAccountIds.length,
    accountIds: importedAccountIds,
    routeRebuilt: importedAccountIds.length > 0
  };
}

export async function refreshOAuthConnection(accountId: number) {
  const account = await findOAuthAccount(accountId);
  if (!account) return null;
  const extraConfig = parseJsonObject(account.extraConfig);
  const refreshToken = readString(extraConfig?.refreshToken);
  const nextExtraConfig = {
    ...(extraConfig || {}),
    lastRefreshAt: nowIso(),
    refreshStatus: refreshToken ? 'stored_refresh_token' : 'no_refresh_token'
  };
  await db.update(schema.accounts)
    .set({
      status: account.accessToken || account.apiToken ? 'active' : account.status,
      extraConfig: stringifyJson(nextExtraConfig),
      updatedAt: nowIso()
    })
    .where(eq(schema.accounts.id, accountId))
    .run();
  await rebuildRoutes({ preserveManual: true });
  return { ok: true, accountId, refreshed: Boolean(refreshToken), routeRebuilt: true };
}

export async function refreshOAuthConnectionQuota(accountId: number) {
  const account = await findOAuthAccount(accountId);
  if (!account) return null;
  const result = await refreshAccountBalance(accountId);
  return { ok: true, ...result };
}

async function upsertOAuthCredential(input: ImportedOAuthCredential) {
  const now = nowIso();
  const accountKey = input.accountKey || input.email || input.username || `${input.provider}:${input.accessToken.slice(0, 12)}`;
  const defaults = providerDefaults[input.provider];
  const existing = await db
    .select()
    .from(schema.accounts)
    .where(and(eq(schema.accounts.oauthProvider, input.provider), eq(schema.accounts.oauthAccountKey, accountKey)))
    .get();
  const extraConfig = stringifyJson({
    ...(input.providerData && typeof input.providerData === 'object' ? input.providerData : {}),
    email: input.email ?? null,
    refreshToken: input.refreshToken ?? null,
    proxyUrl: input.proxyUrl ?? null
  });

  if (existing) {
    return db.update(schema.accounts)
      .set({
        username: input.username ?? input.email ?? existing.username,
        baseUrl: existing.baseUrl || defaults.url,
        platform: input.provider,
        proxyUrl: input.proxyUrl ?? existing.proxyUrl,
        credentialMode: 'oauth',
        accessToken: input.accessToken,
        oauthProvider: input.provider,
        oauthAccountKey: accountKey,
        oauthProjectId: input.projectId ?? existing.oauthProjectId,
        extraConfig,
        status: 'active',
        updatedAt: now
      })
      .where(eq(schema.accounts.id, existing.id))
      .returning()
      .get();
  }

  return db.insert(schema.accounts)
    .values({
      username: input.username ?? input.email ?? accountKey,
      baseUrl: defaults.url,
      platform: input.provider,
      proxyUrl: input.proxyUrl ?? null,
      credentialMode: 'oauth',
      accessToken: input.accessToken,
      oauthProvider: input.provider,
      oauthAccountKey: accountKey,
      oauthProjectId: input.projectId ?? null,
      extraConfig,
      status: 'active',
      createdAt: now,
      updatedAt: now
    })
    .returning()
    .get();
}

async function findOAuthAccount(accountId: number) {
  return db.select().from(schema.accounts).where(and(eq(schema.accounts.id, accountId), eq(schema.accounts.credentialMode, 'oauth'))).get();
}

function buildAuthorizationUrl(provider: OAuthProviderId, state: string, callbackBaseUrl: string | null | undefined, callbackPath: string): string {
  const base = providerDefaults[provider].url;
  const callbackUrl = callbackBaseUrl ? `${callbackBaseUrl.replace(/\/+$/, '')}${callbackPath}` : callbackPath;
  const params = new URLSearchParams({ state, redirect_uri: callbackUrl });
  return `${base.replace(/\/+$/, '')}/oauth/authorize?${params.toString()}`;
}

function credentialFromCallbackUrl(provider: OAuthProviderId, callbackUrl: string, record: OAuthSessionRecord): ImportedOAuthCredential {
  const parsed = parseCallbackUrl(callbackUrl);
  const token = readString(parsed.get('access_token')) || readString(parsed.get('token')) || readString(parsed.get('api_key'));
  if (!token) throw new Error('Callback URL 缺少 access_token/token/api_key');
  return {
    provider,
    accessToken: token,
    refreshToken: readString(parsed.get('refresh_token')),
    accountKey: readString(parsed.get('account_key')) || readString(parsed.get('sub')),
    username: readString(parsed.get('username')),
    email: readString(parsed.get('email')),
    projectId: record.projectId || readString(parsed.get('project_id')),
    proxyUrl: record.proxyUrl,
    providerData: Object.fromEntries(parsed.entries())
  };
}

function parseCallbackUrl(value: string): URLSearchParams {
  try {
    const parsed = new URL(value);
    const params = new URLSearchParams(parsed.search);
    if (parsed.hash.startsWith('#')) {
      new URLSearchParams(parsed.hash.slice(1)).forEach((paramValue, key) => params.set(key, paramValue));
    }
    return params;
  } catch {
    return new URLSearchParams(value.replace(/^\?/, '').replace(/^#/, ''));
  }
}

function normalizeImportedCredentials(input: unknown): ImportedOAuthCredential[] {
  const raw = input && typeof input === 'object' && 'credentials' in input
    ? (input as { credentials: unknown }).credentials
    : input;
  const rows = Array.isArray(raw) ? raw : [raw];
  return rows.map(normalizeImportedCredential);
}

function normalizeImportedCredential(input: unknown): ImportedOAuthCredential {
  if (!input || typeof input !== 'object') throw new Error('OAuth 凭证格式无效');
  const row = input as Record<string, unknown>;
  const provider = normalizeProvider(row.provider);
  const accessToken = readString(row.accessToken) || readString(row.access_token) || readString(row.token);
  if (!provider || !accessToken) throw new Error('OAuth 凭证缺少 provider 或 accessToken');
  return {
    provider,
    accessToken,
    refreshToken: readString(row.refreshToken) || readString(row.refresh_token),
    accountKey: readString(row.accountKey) || readString(row.account_key) || readString(row.sub),
    username: readString(row.username) || readString(row.name),
    email: readString(row.email),
    projectId: readString(row.projectId) || readString(row.project_id),
    proxyUrl: readString(row.proxyUrl) || readString(row.proxy_url),
    providerData: row
  };
}

function normalizeProvider(value: unknown): OAuthProviderId | null {
  if (value === 'codex' || value === 'claude' || value === 'gemini-cli' || value === 'antigravity') return value;
  return null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function toSessionInfo(record: OAuthSessionRecord): OAuthSessionInfo {
  return {
    state: record.state,
    provider: record.provider,
    status: record.status,
    authorizationUrl: record.authorizationUrl,
    callbackPath: record.callbackPath,
    manualCallbackRequired: record.manualCallbackRequired,
    accountId: record.accountId,
    message: record.message,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    expiresAt: record.expiresAt
  };
}
