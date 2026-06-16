import { config } from '../config.js';

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

const oauthProviders: OAuthProviderInfo[] = [
  {
    provider: 'codex',
    label: 'Codex',
    platform: 'codex',
    enabled: true,
    loginType: 'oauth',
    requiresProjectId: false,
    supportsDirectAccountRouting: true,
    supportsCloudValidation: true,
    supportsNativeProxy: true
  },
  {
    provider: 'claude',
    label: 'Claude',
    platform: 'claude',
    enabled: true,
    loginType: 'oauth',
    requiresProjectId: false,
    supportsDirectAccountRouting: true,
    supportsCloudValidation: true,
    supportsNativeProxy: true
  },
  {
    provider: 'gemini-cli',
    label: 'Gemini CLI',
    platform: 'gemini-cli',
    enabled: true,
    loginType: 'oauth',
    requiresProjectId: true,
    supportsDirectAccountRouting: true,
    supportsCloudValidation: true,
    supportsNativeProxy: true
  },
  {
    provider: 'antigravity',
    label: 'Antigravity',
    platform: 'antigravity',
    enabled: true,
    loginType: 'oauth',
    requiresProjectId: false,
    supportsDirectAccountRouting: true,
    supportsCloudValidation: true,
    supportsNativeProxy: true
  }
];

export function listOAuthProviders(): OAuthProvidersResponse {
  return {
    // 先对齐管理端可发现的 provider 元数据，完整 OAuth 授权流程后续接入。
    providers: oauthProviders.map((item) => ({ ...item })),
    defaults: {
      systemProxyConfigured: Boolean(config.systemProxyUrl)
    }
  };
}
