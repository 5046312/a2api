export type SitePlatform =
  | 'openai'
  | 'new-api'
  | 'one-api'
  | 'one-hub'
  | 'done-hub'
  | 'veloera'
  | 'anyrouter'
  | 'sub2api'
  | 'cliproxyapi'
  | 'claude'
  | 'gemini'
  | 'codex'
  | 'gemini-cli'
  | 'antigravity';

export type AdapterRequestContext = {
  siteId: number;
  baseUrl: string;
  platform: SitePlatform;
  proxyUrl?: string | null;
  customHeaders?: Record<string, string> | null;
};

export type VerifyTokenInput = AdapterRequestContext & {
  token: string;
  credentialMode: 'auto' | 'session' | 'apikey' | 'oauth';
};

export type ModelDiscoveryInput = AdapterRequestContext & {
  token: string;
  credentialMode: 'session' | 'apikey' | 'oauth';
};

export type AuthenticatedInput = AdapterRequestContext & {
  accessToken?: string | null;
  apiToken?: string | null;
  platformUserId?: number | null;
};

export type ModelInfo = {
  name: string;
  contextLength?: number | null;
  inputPrice?: number | null;
  outputPrice?: number | null;
  raw?: unknown;
};

export type BalanceInfo = {
  balance: number;
  used: number;
  quota: number;
};

export type TokenVerifyResult = {
  tokenType: 'session' | 'apikey' | 'unknown';
  userInfo?: {
    username: string;
    displayName?: string;
    email?: string;
  } | null;
  balance?: {
    balance: number;
    used: number;
    quota: number;
  } | null;
  apiToken?: string | null;
  models?: ModelInfo[];
};

export type ApiTokenInfo = {
  name: string;
  key: string;
  enabled?: boolean;
  tokenGroup?: string | null;
};

export type PlatformAdapter = {
  readonly platformName: SitePlatform;
  detect(url: string): Promise<boolean>;
  verifyToken(input: VerifyTokenInput): Promise<TokenVerifyResult>;
  getBalance?(input: AuthenticatedInput): Promise<BalanceInfo | null>;
  getModels(input: ModelDiscoveryInput): Promise<ModelInfo[]>;
  getApiTokens?(input: AuthenticatedInput): Promise<ApiTokenInfo[]>;
};
