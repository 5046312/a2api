import { clearAdminToken, getAdminToken } from './authSession';

export type ListResponse<T> = {
  items: T[];
  total: number;
  page?: number;
  pageSize?: number;
};

export type Site = {
  id: number;
  name: string;
  url: string;
  platform: string;
  status: string;
  globalWeight: number;
  isPinned: boolean;
  sortOrder: number;
  proxyUrl: string | null;
  useSystemProxy: boolean;
  customHeaders: Record<string, unknown> | null;
};

export type SiteEndpoint = {
  id: number;
  siteId: number;
  url: string;
  enabled: boolean;
  sortOrder: number;
  cooldownUntil: string | null;
  lastSelectedAt: string | null;
  lastFailedAt: string | null;
  lastFailureReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SiteDisabledModels = {
  siteId: number;
  models: string[];
  routeRebuilt?: boolean;
};

export type SiteAvailableModels = {
  siteId: number;
  models: string[];
};

export type SiteBatchAction = 'enable' | 'disable' | 'delete' | 'enableSystemProxy' | 'disableSystemProxy';

export type SiteBatchResult = {
  ok: boolean;
  action: SiteBatchAction;
  successIds: number[];
  failedItems: Array<{ id: number; message: string }>;
  updated: number;
  deleted: number;
  routeRebuilt: boolean;
};

export type Account = {
  id: number;
  siteId: number;
  siteName: string | null;
  name: string | null;
  baseUrl: string | null;
  platform: string | null;
  customHeaders: Record<string, unknown> | null;
  useSystemProxy: boolean;
  username: string | null;
  credentialMode: string;
  status: string;
  isPinned: boolean;
  sortOrder: number;
  balance: number;
  balanceUsed: number;
  quota: number;
  unitCost: number | null;
  lastBalanceRefresh: string | null;
  apiKeyMasked: string;
  apiTokenMasked: string;
  proxyUrl: string | null;
  extraConfig: Record<string, unknown> | null;
  modelCount: number;
};

export type AccountModels = {
  accountId: number;
  models: string[];
};

export type AccountModelsUpdateResult = AccountModels & {
  created: number;
  updated: number;
  routeRebuilt: boolean;
};

export type AccountBatchAction = 'enable' | 'disable' | 'delete' | 'refreshBalance';

export type AccountBatchResult = {
  ok: boolean;
  action: AccountBatchAction;
  successIds: number[];
  failedItems: Array<{ id: number; message: string }>;
  updated: number;
  deleted: number;
  refreshed: number;
  routeRebuilt: boolean;
};

export type OAuthProviderInfo = {
  provider: 'codex' | 'claude' | 'gemini-cli' | 'antigravity';
  label: string;
  platform: string;
  enabled: boolean;
  loginType: 'oauth';
  requiresProjectId: boolean;
  supportsDirectAccountRouting: boolean;
  supportsCloudValidation: boolean;
  supportsNativeProxy: boolean;
};

export type OAuthProvidersResponse = {
  providers: OAuthProviderInfo[];
  defaults: {
    systemProxyConfigured: boolean;
  };
};

export type OAuthConnectionInfo = {
  accountId: number;
  siteId: number;
  provider: string;
  username: string | null;
  email: string | null;
  accountKey: string | null;
  projectId: string | null;
  modelCount: number;
  modelsPreview: string[];
  accountStatus: string;
  enabled: boolean;
  status: 'healthy' | 'abnormal';
  routeChannelCount: number;
  lastModelSyncAt: string | null;
  proxyUrl: string | null;
  site: {
    id: number;
    name: string;
    url: string;
    platform: string;
  } | null;
};

export type OAuthConnectionsResponse = {
  items: OAuthConnectionInfo[];
  total: number;
  limit: number;
  offset: number;
};

export type OAuthSessionInfo = {
  state: string;
  provider: OAuthProviderInfo['provider'];
  status: 'pending' | 'success' | 'error';
  authorizationUrl: string;
  callbackPath: string;
  manualCallbackRequired: boolean;
  accountId: number | null;
  message: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
};

export type OAuthImportResult = {
  ok: boolean;
  imported: number;
  accountIds: number[];
  routeRebuilt: boolean;
};

export type BalanceRefreshResult = {
  accountId: number;
  balance: number;
  used: number;
  quota: number;
  refreshedAt: string | null;
  skipped: boolean;
  reason: string | null;
};

export type BalanceRefreshAllResult = {
  items: BalanceRefreshResult[];
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
};

export type AccountToken = {
  id: number;
  accountId: number;
  accountName: string | null;
  siteName: string | null;
  name: string;
  tokenMasked: string;
  tokenGroup: string | null;
  enabled: boolean;
  isDefault: boolean;
  valueStatus: string;
};

export type AccountTokenSyncResult = {
  created: number;
  updated: number;
  maskedPending: number;
  preservedLocalFields: string[];
};

export type RouteItem = {
  id: number;
  modelPattern: string;
  displayName: string | null;
  routeMode: string;
  routingStrategy: string;
  enabled: boolean;
  channelCount: number;
  successCount: number;
  failCount: number;
};

export type RouteLiteItem = {
  id: number;
  modelPattern: string;
  displayName: string | null;
  routeMode: string;
  modelMapping: string | null;
  routingStrategy: string;
  enabled: boolean;
  manualOverride: boolean;
};

export type RouteSummaryItem = RouteLiteItem & {
  channelCount: number;
  enabledChannelCount: number;
  siteNames: string[];
};

export type RouteChannel = {
  id: number;
  routeId: number;
  accountId: number;
  tokenId: number | null;
  sourceModel: string;
  priority: number;
  weight: number;
  enabled: boolean;
  successCount: number;
  failCount: number;
  cooldownUntil: string | null;
  siteName: string | null;
  accountName: string | null;
  tokenName: string | null;
};

export type RouteDecisionCandidate = {
  channelId: number;
  accountId: number;
  tokenId: number | null;
  siteId: number;
  siteName: string;
  accountName: string | null;
  tokenName: string | null;
  priority: number;
  weight: number;
  score: number;
  probability: number;
  available: boolean;
  reasons: string[];
  cooldownUntil: string | null;
};

export type RouteDecision = {
  requestedModel: string;
  actualModel: string;
  matched: boolean;
  routeId: number;
  modelPattern: string | null;
  displayName: string | null;
  routingStrategy: string | null;
  selectedChannelId: number | null;
  selectedAccountId: number | null;
  selectedSiteId: number | null;
  priority: number | null;
  summary: string[];
  candidates: RouteDecisionCandidate[];
  filtered: Array<{ channelId: number; reason: string }>;
};

export type RouteDecisionSnapshot = {
  id: number;
  routeId: number;
  requestedModel: string;
  refreshedAt: string;
  snapshot: RouteDecision | Record<string, unknown>;
};

export type RouteGroupSource = {
  id: number;
  groupRouteId: number;
  sourceRouteId: number;
  createdAt: string;
  modelPattern: string;
  displayName: string | null;
  enabled: boolean;
};

export type DownstreamKey = {
  id: number;
  name: string;
  key?: string;
  keyMasked: string;
  description: string | null;
  enabled: boolean;
  expiresAt: string | null;
  maxCost: number | null;
  usedCost: number;
  modelScope: 'all' | 'selected';
  supportedModels: string[];
  allowedRouteIds: number[];
  allowedSiteIds: number[];
  allowedCredentialRefs: CredentialRef[];
  siteWeightMultipliers: Record<string, number>;
  excludedSiteIds: number[];
  excludedCredentialRefs: CredentialRef[];
  usedRequests: number;
  maxRequests: number | null;
  lastUsedAt: string | null;
};

export type DownstreamKeyBatchAction = 'enable' | 'disable' | 'delete' | 'resetUsage';

export type DownstreamKeyBatchResult = {
  ok: boolean;
  action: DownstreamKeyBatchAction;
  successIds: number[];
  failedItems: Array<{ id: number; message: string }>;
  updated: number;
  deleted: number;
  reset: number;
};

export type CredentialRef =
  | { kind: 'account'; siteId: number; accountId: number }
  | { kind: 'account_token'; siteId: number; accountId: number; tokenId: number };

export type ProxyLog = {
  id: number;
  createdAt: string;
  routeId: number | null;
  channelId: number | null;
  siteId: number | null;
  siteName: string | null;
  accountId: number | null;
  accountName: string | null;
  downstreamApiKeyId: number | null;
  downstreamKeyName: string | null;
  status: string;
  modelRequested: string | null;
  modelActual: string | null;
  httpStatus: number | null;
  isStream: boolean;
  firstByteLatencyMs: number | null;
  latencyMs: number | null;
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  estimatedCost: number;
  billingDetails: unknown | null;
  debugTraceId: number | null;
  errorMessage: string | null;
  retryCount: number;
};

export type ProxyDebugAttempt = {
  id: number;
  traceId: number;
  attemptIndex: number;
  endpoint: string;
  requestPath: string;
  targetUrl: string;
  runtimeExecutor: string | null;
  responseStatus: number | null;
  rawErrorText: string | null;
  requestHeaders: Record<string, unknown> | null;
  responseHeaders: Record<string, unknown> | null;
  createdAt: string;
};

export type ProxyDebugTrace = {
  id: number;
  downstreamPath: string;
  requestedModel: string | null;
  downstreamApiKeyId: number | null;
  selectedChannelId: number | null;
  selectedRouteId: number | null;
  selectedAccountId: number | null;
  selectedSiteId: number | null;
  selectedSitePlatform: string | null;
  finalStatus: string | null;
  finalHttpStatus: number | null;
  finalUpstreamPath: string | null;
  requestHeaders: Record<string, unknown> | null;
  decisionSummary: Record<string, unknown> | null;
  finalResponseHeaders: Record<string, unknown> | null;
  attempts: ProxyDebugAttempt[];
  createdAt: string;
  updatedAt: string;
};

export type SettingsSnapshot = {
  systemProxyUrl: string;
  proxyFirstByteTimeoutSec: number;
  proxyMaxChannelAttempts: number;
  tokenRouterCacheTtlMs: number;
  balanceRefreshCron: string;
  logCleanupCron: string;
  logCleanupRetentionDays: number;
  adminIpAllowlist: string[];
  notificationWebhookEnabled: boolean;
  notificationWebhookUrl: string;
  notificationWebhookUrlMasked: string;
  notifyCooldownSec: number;
};

export type SystemProxyTestResult = {
  ok: true;
  proxyUrl: string;
  probeUrl: string;
  finalUrl: string;
  reachable: true;
  statusCode: number;
  upstreamOk: boolean;
  latencyMs: number;
};

export type RuntimeDatabaseState = {
  success: true;
  active: {
    dialect: 'sqlite';
    connection: string;
    ssl: false;
  };
  saved: null;
  restartRequired: false;
};

export type ClearRuntimeCacheResult = {
  ok: true;
  message: string;
  deletedModelAvailability: number;
  deletedTokenModelAvailability: number;
  deletedRouteChannels: number;
  deletedTokenRoutes: number;
};

export type ClearUsageDataResult = {
  ok: true;
  message: string;
  deletedProxyLogs: number;
  deletedProxyDebugTraces: number;
  deletedProxyDebugAttempts: number;
  deletedMonitorHeartbeats: number;
  resetRouteChannels: number;
  resetAccounts: number;
  resetDownstreamKeys: number;
};

export type FactoryResetResult = {
  ok: true;
  success: true;
  message: string;
  deleted: Record<string, number>;
};

export type MonitorStatus = 'up' | 'down' | 'pending' | 'maintenance';

export type MonitorSettings = {
  enabled: boolean;
  intervalSec: number;
  timeoutSec: number;
  maxRetries: number;
  concurrency: number;
  retentionDays: number;
  notifyOnDown: boolean;
  notifyOnRecovery: boolean;
};

export type MonitorHeartbeat = {
  id: number;
  monitorId: number;
  accountId: number;
  status: MonitorStatus;
  checkedAt: string;
  latencyMs: number | null;
  message: string | null;
  retries: number;
  important: boolean;
  errorType: string | null;
  modelCount: number | null;
};

export type MonitorAccount = {
  id: number;
  accountId: number;
  accountName: string;
  accountStatus: string;
  siteId: number;
  siteName: string;
  siteUrl: string;
  sitePlatform: string;
  siteStatus: string;
  enabled: boolean;
  active: boolean;
  intervalSec: number | null;
  status: MonitorStatus;
  lastCheckAt: string | null;
  lastUpAt: string | null;
  lastDownAt: string | null;
  nextCheckAt: string | null;
  consecutiveFailCount: number;
  consecutiveSuccessCount: number;
  latencyMs: number | null;
  lastMessage: string | null;
  uptime24h: number | null;
  uptime7d: number | null;
  heartbeats: MonitorHeartbeat[];
  events?: MonitorHeartbeat[];
};

export type MonitorOverview = {
  settings: MonitorSettings;
  totalAccounts: number;
  enabledAccounts: number;
  disabledAccounts: number;
  statusCount: Record<MonitorStatus, number>;
  averageLatencyMs: number | null;
  uptime24h: number | null;
  uptime7d: number | null;
  lastIncident: MonitorHeartbeat | null;
};

export type MonitorCheckAllResult = {
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
  items: unknown[];
};

export type NotificationSettings = {
  webhookEnabled: boolean;
  webhookUrlMasked: string;
  notifyCooldownSec: number;
};

export type EventItem = {
  id: number;
  type: string;
  title: string;
  message: string | null;
  level: string;
  read: boolean;
  relatedId: number | null;
  relatedType: string | null;
  createdAt: string;
};

export type BackgroundTaskLogEntry = {
  seq: number;
  message: string;
  createdAt: string;
};

export type BackgroundTask = {
  id: string;
  type: string;
  title: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  message: string;
  error: string | null;
  result: unknown;
  dedupeKey: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  expiresAtMs: number;
  logs: BackgroundTaskLogEntry[];
};

export type SiteAnnouncement = {
  id: number;
  siteId: number;
  siteName: string | null;
  platform: string;
  sourceKey: string;
  title: string;
  content: string;
  level: 'info' | 'warning' | 'error';
  sourceUrl: string | null;
  startsAt: string | null;
  endsAt: string | null;
  upstreamCreatedAt: string | null;
  upstreamUpdatedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  readAt: string | null;
  dismissedAt: string | null;
};

export type StatsOverview = {
  todayRequests: number;
  todaySuccessRate: number;
  todayTokens: number;
  todayCost: number;
  activeSiteCount: number;
  abnormalAccountCount: number;
};

export type SiteUsageItem = {
  bucket: string;
  siteId: number | null;
  siteName: string | null;
  requests: number;
  successRequests: number;
  successRate: number;
  totalTokens: number;
  estimatedCost: number;
  averageLatencyMs: number;
};

export type ModelUsageItem = {
  model: string;
  requests: number;
  successRequests: number;
  successRate: number;
  totalTokens: number;
  estimatedCost: number;
  averageLatencyMs: number;
};

export type StatsMarketplaceItem = {
  model: string;
  siteCount: number;
  accountCount: number;
  tokenCount: number;
  minCost: number;
  avgLatencyMs: number;
  successRate: number;
};

export type TestChatPayload = {
  model: string;
  messages: unknown[];
  stream?: false;
  downstreamApiKeyId?: number;
  forcedChannelId?: number;
  [key: string]: unknown;
};

export type TestChatResult = Record<string, unknown>;

export type BackupType = 'accounts' | 'preferences' | 'all';

export type BackupDocument = {
  version: 'a2api-1';
  timestamp: number;
  type: BackupType;
  accounts?: Record<string, unknown>;
  preferences?: Record<string, unknown>;
};

export type BackupImportResult = {
  allImported: boolean;
  sections: {
    accounts: boolean;
    preferences: boolean;
  };
  summary: {
    created: number;
    updated: number;
    skipped: number;
    importedSites: number;
    importedAccounts: number;
    importedTokens: number;
    importedRoutes: number;
    importedDownstreamKeys: number;
    importedProxyFiles: number;
    importedProxyVideoTasks: number;
    importedSiteAnnouncements: number;
    importedPreferences: number;
  };
  warnings: string[];
  routeRebuild?: {
    routesCreated: number;
    routesUpdated: number;
    channelsCreated: number;
    channelsUpdated: number;
    channelsRemoved: number;
  };
};

export type BackupWebdavConfig = {
  enabled: boolean;
  fileUrl: string;
  username: string;
  exportType: BackupType;
  autoSyncEnabled: boolean;
  autoSyncCron: string;
  hasPassword: boolean;
  passwordMasked: string;
};

export type BackupWebdavState = {
  lastSyncAt: string | null;
  lastError: string | null;
};

export type BackupWebdavSnapshot = {
  success: true;
  config: BackupWebdavConfig;
  state: BackupWebdavState;
};

export type BackupWebdavExportResult = {
  success: true;
  fileUrl: string;
  exportType: BackupType;
  syncedAt: string;
  lastSyncAt: string;
  lastError: null;
};

export type BackupWebdavImportResult = BackupImportResult & {
  success: true;
  fileUrl: string;
  syncedAt: string;
  lastSyncAt: string;
  lastError: null;
};

export type ClientConfigFile = {
  filename: string;
  language: 'json' | 'toml' | 'env' | 'text';
  content: string;
};

export type ClientConfigField = {
  label: string;
  value: string;
};

export type ClientConfigItem = {
  id: string;
  name: string;
  description: string;
  fields: ClientConfigField[];
  files: ClientConfigFile[];
};

export type ClientConfigSnapshot = {
  baseUrl: string;
  baseUrlV1: string;
  model: string;
  apiKeyPlaceholder: string;
  items: ClientConfigItem[];
};

type RequestOptions = {
  method?: string;
  body?: unknown;
};

type QueryValue = string | number | boolean | null | undefined;

function buildQuery(path: string, query: Record<string, QueryValue>): string {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== '' && value !== null && value !== undefined) {
      params.set(key, String(value));
    }
  });
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

async function parseResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  return JSON.parse(text) as unknown;
}

function errorMessageFrom(data: unknown, fallback: string): string {
  if (!data || typeof data !== 'object') return fallback;
  const payload = data as { error?: string | { message?: string }; message?: string };
  if (typeof payload.error === 'string') return payload.error;
  if (payload.error && typeof payload.error === 'object' && payload.error.message) return payload.error.message;
  return payload.message || fallback;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${getAdminToken()}`
  };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const init: RequestInit = {
    method: options.method || 'GET',
    headers
  };
  if (options.body !== undefined) init.body = JSON.stringify(options.body);

  const response = await fetch(path, init);

  if (response.status === 401 || response.status === 403) {
    clearAdminToken();
  }

  const data = await parseResponse(response);
  if (!response.ok) {
    throw new Error(errorMessageFrom(data, response.statusText || 'Request failed'));
  }

  return data as T;
}

export const api = {
  authCheck: () => apiRequest<{ ok: boolean }>('/api/auth/check'),
  getAuthInfo: () => apiRequest<{ masked: string }>('/api/settings/auth/info'),
  listSites: (query: Record<string, QueryValue> = {}) => apiRequest<ListResponse<Site>>(buildQuery('/api/sites', query)),
  createSite: (body: unknown) => apiRequest<Site>('/api/sites', { method: 'POST', body }),
  updateSite: (id: number, body: unknown) => apiRequest<Site>(`/api/sites/${id}`, { method: 'PUT', body }),
  deleteSite: (id: number) => apiRequest<{ ok: boolean }>(`/api/sites/${id}`, { method: 'DELETE' }),
  batchUpdateSites: (ids: number[], action: SiteBatchAction) =>
    apiRequest<SiteBatchResult>('/api/sites/batch', { method: 'POST', body: { ids, action } }),
  detectSite: (url: string) =>
    apiRequest<{ platform: string | null; message: string }>('/api/sites/detect', { method: 'POST', body: { url } }),
  listSiteEndpoints: (siteId: number) =>
    apiRequest<{ items: SiteEndpoint[]; total: number }>(`/api/sites/${siteId}/endpoints`),
  createSiteEndpoint: (siteId: number, body: unknown) =>
    apiRequest<SiteEndpoint>(`/api/sites/${siteId}/endpoints`, { method: 'POST', body }),
  updateSiteEndpoint: (endpointId: number, body: unknown) =>
    apiRequest<SiteEndpoint>(`/api/sites/endpoints/${endpointId}`, { method: 'PUT', body }),
  deleteSiteEndpoint: (endpointId: number) =>
    apiRequest<{ ok: boolean }>(`/api/sites/endpoints/${endpointId}`, { method: 'DELETE' }),
  listSiteDisabledModels: (siteId: number) =>
    apiRequest<SiteDisabledModels>(`/api/sites/${siteId}/disabled-models`),
  updateSiteDisabledModels: (siteId: number, models: string[]) =>
    apiRequest<SiteDisabledModels>(`/api/sites/${siteId}/disabled-models`, { method: 'PUT', body: { models } }),
  listSiteAvailableModels: (siteId: number) =>
    apiRequest<SiteAvailableModels>(`/api/sites/${siteId}/available-models`),
  listAccounts: (query: Record<string, QueryValue> = {}) =>
    apiRequest<ListResponse<Account>>(buildQuery('/api/accounts', query)),
  verifyAccountToken: (body: unknown) => apiRequest('/api/accounts/verify-token', { method: 'POST', body }),
  createAccount: (body: unknown) => apiRequest<Account>('/api/accounts', { method: 'POST', body }),
  updateAccount: (id: number, body: unknown) => apiRequest<Account>(`/api/accounts/${id}`, { method: 'PUT', body }),
  deleteAccount: (id: number) => apiRequest<{ ok: boolean }>(`/api/accounts/${id}`, { method: 'DELETE' }),
  batchUpdateAccounts: (ids: number[], action: AccountBatchAction) =>
    apiRequest<AccountBatchResult>('/api/accounts/batch', { method: 'POST', body: { ids, action } }),
  getOAuthProviders: () => apiRequest<OAuthProvidersResponse>('/api/oauth/providers'),
  getOAuthConnections: (query: Record<string, QueryValue> = {}) =>
    apiRequest<OAuthConnectionsResponse>(buildQuery('/api/oauth/connections', query)),
  updateOAuthConnection: (accountId: number, body: { enabled: boolean }) =>
    apiRequest<OAuthConnectionInfo & { routeRebuilt: boolean }>(`/api/oauth/connections/${accountId}`, {
      method: 'PATCH',
      body
    }),
  deleteOAuthConnection: (accountId: number) =>
    apiRequest<{ ok: boolean; routeRebuilt: boolean }>(`/api/oauth/connections/${accountId}`, { method: 'DELETE' }),
  startOAuthSession: (provider: OAuthProviderInfo['provider'], body: unknown = {}) =>
    apiRequest<OAuthSessionInfo>(`/api/oauth/providers/${provider}/start`, { method: 'POST', body }),
  getOAuthSession: (state: string) => apiRequest<OAuthSessionInfo>(`/api/oauth/sessions/${state}`),
  completeOAuthSession: (state: string, callbackUrl: string) =>
    apiRequest<OAuthSessionInfo>(`/api/oauth/sessions/${state}/manual-callback`, { method: 'POST', body: { callbackUrl } }),
  refreshOAuthConnection: (accountId: number) =>
    apiRequest<{ ok: boolean; accountId: number; refreshed: boolean; routeRebuilt: boolean }>(`/api/oauth/connections/${accountId}/refresh`, { method: 'POST' }),
  refreshOAuthQuota: (accountId: number) =>
    apiRequest<BalanceRefreshResult & { ok: boolean }>(`/api/oauth/connections/${accountId}/quota`, { method: 'POST' }),
  importOAuthCredentials: (body: unknown) => apiRequest<OAuthImportResult>('/api/oauth/import', { method: 'POST', body }),
  refreshBalance: (id: number) =>
    apiRequest<BalanceRefreshResult>(`/api/accounts/${id}/balance`, { method: 'POST' }),
  refreshAllBalances: () =>
    apiRequest<BalanceRefreshAllResult>('/api/accounts/balance/refresh-all', { method: 'POST' }),
  listAccountModels: (id: number) =>
    apiRequest<AccountModels>(`/api/accounts/${id}/models`),
  updateAccountModels: (id: number, models: string[]) =>
    apiRequest<AccountModelsUpdateResult>(`/api/accounts/${id}/models`, { method: 'PUT', body: { models } }),
  refreshModels: (id: number) =>
    apiRequest<{ accountId: number; created: number; updated: number; removed: number; routeRebuilt: boolean }>(`/api/accounts/${id}/models/refresh`, {
      method: 'POST'
    }),
  listTokens: (query: Record<string, QueryValue> = {}) =>
    apiRequest<ListResponse<AccountToken>>(buildQuery('/api/account-tokens', query)),
  createToken: (body: unknown) => apiRequest<AccountToken>('/api/account-tokens', { method: 'POST', body }),
  updateToken: (id: number, body: unknown) =>
    apiRequest<AccountToken>(`/api/account-tokens/${id}`, { method: 'PUT', body }),
  batchSetTokensEnabled: (ids: number[], enabled: boolean) =>
    apiRequest<{ ok: boolean; updated: number }>('/api/account-tokens/batch-enabled', {
      method: 'POST',
      body: { ids, enabled }
    }),
  deleteToken: (id: number) => apiRequest<{ ok: boolean }>(`/api/account-tokens/${id}`, { method: 'DELETE' }),
  syncAccountTokens: (accountId: number) =>
    apiRequest<AccountTokenSyncResult>('/api/account-tokens/sync', { method: 'POST', body: { accountId } }),
  listRoutes: () => apiRequest<{ items: RouteItem[]; total: number }>('/api/routes'),
  listRoutesLite: () => apiRequest<RouteLiteItem[]>('/api/routes/lite'),
  listRoutesSummary: () => apiRequest<RouteSummaryItem[]>('/api/routes/summary'),
  updateRoute: (id: number, body: unknown) => apiRequest(`/api/routes/${id}`, { method: 'PUT', body }),
  rebuildRoutes: () => apiRequest('/api/routes/rebuild', { method: 'POST' }),
  listRouteChannels: (id: number) => apiRequest<{ items: RouteChannel[]; total: number }>(`/api/routes/${id}/channels`),
  explainRouteDecision: (id: number, model: string, options: { downstreamApiKeyId?: number; forcedChannelId?: number } = {}) =>
    apiRequest<RouteDecision>(buildQuery(`/api/routes/${id}/decision`, {
      model,
      downstreamApiKeyId: options.downstreamApiKeyId,
      forcedChannelId: options.forcedChannelId
    })),
  listRouteSnapshots: (limit = 100) =>
    apiRequest<{ items: RouteDecisionSnapshot[] }>(buildQuery('/api/routes/snapshots', { limit })),
  getRouteSnapshot: (id: number) => apiRequest<RouteDecisionSnapshot>(`/api/routes/${id}/snapshot`),
  refreshRouteSnapshot: (id: number, model?: string) =>
    apiRequest<RouteDecisionSnapshot>(`/api/routes/${id}/snapshot/refresh`, { method: 'POST', body: { model } }),
  listRouteGroupSources: (id: number) =>
    apiRequest<{ items: RouteGroupSource[]; total: number }>(`/api/routes/${id}/group-sources`),
  updateRouteGroupSources: (id: number, sourceRouteIds: number[]) =>
    apiRequest<{ groupRouteId: number; requestedSourceRouteIds: number[]; savedSourceRouteIds: number[]; skippedSourceRouteIds: number[] }>(
      `/api/routes/${id}/group-sources`,
      { method: 'PUT', body: { sourceRouteIds } }
    ),
  clearRouteCooldown: (id: number) => apiRequest(`/api/routes/${id}/cooldown/clear`, { method: 'POST' }),
  listDownstreamKeys: () => apiRequest<{ items: DownstreamKey[] }>('/api/downstream-keys'),
  createDownstreamKey: (body: unknown) =>
    apiRequest<DownstreamKey>('/api/downstream-keys', { method: 'POST', body }),
  updateDownstreamKey: (id: number, body: unknown) =>
    apiRequest<DownstreamKey>(`/api/downstream-keys/${id}`, { method: 'PUT', body }),
  resetDownstreamKeyUsage: (id: number) =>
    apiRequest<DownstreamKey>(`/api/downstream-keys/${id}/reset-usage`, { method: 'POST' }),
  batchUpdateDownstreamKeys: (ids: number[], action: DownstreamKeyBatchAction) =>
    apiRequest<DownstreamKeyBatchResult>('/api/downstream-keys/batch', { method: 'POST', body: { ids, action } }),
  deleteDownstreamKey: (id: number) => apiRequest<{ ok: boolean }>(`/api/downstream-keys/${id}`, { method: 'DELETE' }),
  listProxyLogs: (query: Record<string, QueryValue> = {}) =>
    apiRequest<ListResponse<ProxyLog>>(buildQuery('/api/proxy-logs', query)),
  getProxyLog: (id: number) => apiRequest<ProxyLog>(`/api/proxy-logs/${id}`),
  listProxyDebugTraces: (query: Record<string, QueryValue> = {}) =>
    apiRequest<{ items: Array<Omit<ProxyDebugTrace, 'attempts' | 'requestHeaders' | 'decisionSummary' | 'finalResponseHeaders'> & { attemptCount: number }> }>(
      buildQuery('/api/proxy-debug-traces', query)
    ),
  getProxyDebugTrace: (id: number) => apiRequest<ProxyDebugTrace>(`/api/proxy-debug-traces/${id}`),
  getSettings: () => apiRequest<SettingsSnapshot>('/api/settings'),
  getRuntimeSettings: () => apiRequest<SettingsSnapshot>('/api/settings/runtime'),
  getBrandList: () => apiRequest<{ brands: string[] }>('/api/settings/brand-list'),
  getRuntimeDatabaseConfig: () => apiRequest<RuntimeDatabaseState>('/api/settings/database/runtime'),
  updateSettings: (body: unknown) => apiRequest<SettingsSnapshot>('/api/settings', { method: 'PUT', body }),
  updateRuntimeSettings: (body: unknown) => apiRequest<SettingsSnapshot>('/api/settings/runtime', { method: 'PUT', body }),
  testSystemProxy: (body: { proxyUrl?: string }) =>
    apiRequest<SystemProxyTestResult>('/api/settings/test-proxy', { method: 'POST', body }),
  testRuntimeSystemProxy: (body: { proxyUrl?: string }) =>
    apiRequest<SystemProxyTestResult>('/api/settings/system-proxy/test', { method: 'POST', body }),
  clearRuntimeCache: () =>
    apiRequest<ClearRuntimeCacheResult>('/api/settings/maintenance/clear-cache', { method: 'POST' }),
  clearUsageData: () =>
    apiRequest<ClearUsageDataResult>('/api/settings/maintenance/clear-usage', { method: 'POST' }),
  factoryReset: () =>
    apiRequest<FactoryResetResult>('/api/settings/maintenance/factory-reset', { method: 'POST' }),
  getMonitorOverview: () => apiRequest<MonitorOverview>('/api/monitor/overview'),
  listMonitorAccounts: (query: Record<string, QueryValue> = {}) =>
    apiRequest<ListResponse<MonitorAccount>>(buildQuery('/api/monitor/accounts', query)),
  getMonitorAccount: (accountId: number) =>
    apiRequest<MonitorAccount>(`/api/monitor/accounts/${accountId}`),
  checkMonitorAccount: (accountId: number) =>
    apiRequest<{ accountId: number; status: MonitorStatus; checkedAt: string; latencyMs: number | null; message: string }>(
      `/api/monitor/accounts/${accountId}/check`,
      { method: 'POST' }
    ),
  checkAllMonitorAccounts: () => apiRequest<MonitorCheckAllResult>('/api/monitor/check-all', { method: 'POST' }),
  updateMonitorAccount: (accountId: number, body: { enabled?: boolean; intervalSec?: number | null }) =>
    apiRequest<MonitorAccount>(`/api/monitor/accounts/${accountId}`, { method: 'PATCH', body }),
  getMonitorSettings: () => apiRequest<MonitorSettings>('/api/monitor/settings'),
  updateMonitorSettings: (body: Partial<MonitorSettings>) =>
    apiRequest<MonitorSettings>('/api/monitor/settings', { method: 'PUT', body }),
  clearMonitorHeartbeats: () => apiRequest<{ deleted: number }>('/api/monitor/heartbeats', { method: 'DELETE' }),
  getNotificationSettings: () => apiRequest<NotificationSettings>('/api/settings/notifications'),
  updateNotificationSettings: (body: unknown) =>
    apiRequest<NotificationSettings>('/api/settings/notifications', { method: 'PUT', body }),
  testNotifications: () => apiRequest<{ ok: boolean; message: string }>('/api/settings/notifications/test', { method: 'POST' }),
  testNotification: () => apiRequest<{ ok: boolean; success: boolean; message: string }>('/api/settings/notify/test', { method: 'POST' }),
  listEvents: (query: Record<string, QueryValue> = {}) =>
    apiRequest<ListResponse<EventItem>>(buildQuery('/api/events', query)),
  getEventCount: () => apiRequest<{ count: number }>('/api/events/count'),
  markEventRead: (id: number) => apiRequest<{ ok: boolean }>(`/api/events/${id}/read`, { method: 'POST' }),
  markAllEventsRead: () => apiRequest<{ ok: boolean; updated: number }>('/api/events/read-all', { method: 'POST' }),
  clearEvents: () => apiRequest<{ ok: boolean; deleted: number }>('/api/events', { method: 'DELETE' }),
  listTasks: (limit = 50) => apiRequest<{ tasks: BackgroundTask[] }>(buildQuery('/api/tasks', { limit })),
  getTask: (id: string) => apiRequest<{ ok: boolean; task: BackgroundTask }>(`/api/tasks/${encodeURIComponent(id)}`),
  listSiteAnnouncements: (query: Record<string, QueryValue> = {}) =>
    apiRequest<ListResponse<SiteAnnouncement>>(buildQuery('/api/site-announcements', query)),
  markSiteAnnouncementRead: (id: number) =>
    apiRequest<{ ok: boolean }>(`/api/site-announcements/${id}/read`, { method: 'POST' }),
  markAllSiteAnnouncementsRead: () =>
    apiRequest<{ ok: boolean; updated: number }>('/api/site-announcements/read-all', { method: 'POST' }),
  dismissSiteAnnouncement: (id: number) =>
    apiRequest<{ ok: boolean }>(`/api/site-announcements/${id}/dismiss`, { method: 'POST' }),
  clearSiteAnnouncements: () => apiRequest<{ ok: boolean; deleted: number }>('/api/site-announcements', { method: 'DELETE' }),
  getStatsOverview: () => apiRequest<StatsOverview>('/api/stats/overview'),
  getSiteUsageStats: (query: Record<string, QueryValue> = {}) =>
    apiRequest<{ items: SiteUsageItem[] }>(buildQuery('/api/stats/site-usage', query)),
  getModelUsageStats: (query: Record<string, QueryValue> = {}) =>
    apiRequest<{ items: ModelUsageItem[] }>(buildQuery('/api/stats/model-usage', query)),
  getStatsMarketplace: () => apiRequest<{ items: StatsMarketplaceItem[] }>('/api/stats/marketplace'),
  testChat: (body: TestChatPayload) => apiRequest<TestChatResult>('/api/test/chat', { method: 'POST', body }),
  exportBackup: (type: BackupType) => apiRequest<BackupDocument>(buildQuery('/api/settings/backup/export', { type })),
  importBackup: (backup: unknown, type?: BackupType) =>
    apiRequest<BackupImportResult>('/api/settings/backup/import', { method: 'POST', body: { backup, type } }),
  getBackupWebdavConfig: () => apiRequest<BackupWebdavSnapshot>('/api/settings/backup/webdav'),
  updateBackupWebdavConfig: (body: unknown) =>
    apiRequest<BackupWebdavSnapshot>('/api/settings/backup/webdav', { method: 'PUT', body }),
  exportBackupToWebdav: (type?: BackupType) =>
    apiRequest<BackupWebdavExportResult>('/api/settings/backup/webdav/export', { method: 'POST', body: { type } }),
  importBackupFromWebdav: () =>
    apiRequest<BackupWebdavImportResult>('/api/settings/backup/webdav/import', { method: 'POST' }),
  getClientConfigs: (query: { baseUrl?: string; model?: string } = {}) =>
    apiRequest<ClientConfigSnapshot>(buildQuery('/api/client-configs', query))
};
