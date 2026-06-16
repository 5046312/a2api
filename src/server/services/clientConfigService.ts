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

const API_KEY_PLACEHOLDER = '<your-proxy-key>';
const MODEL_PLACEHOLDER = '<model-from-v1-models>';

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function normalizeBaseUrl(input: string): { baseUrl: string; baseUrlV1: string } {
  const url = new URL(stripTrailingSlash(input));
  const baseUrl = stripTrailingSlash(url.toString());
  const baseUrlV1 = baseUrl.endsWith('/v1') ? baseUrl : `${baseUrl}/v1`;
  const rootBaseUrl = baseUrlV1.endsWith('/v1') ? baseUrlV1.slice(0, -3) : baseUrl;
  return {
    baseUrl: stripTrailingSlash(rootBaseUrl),
    baseUrlV1: stripTrailingSlash(baseUrlV1)
  };
}

function jsonFile(filename: string, value: unknown): ClientConfigFile {
  return {
    filename,
    language: 'json',
    content: JSON.stringify(value, null, 2)
  };
}

function commonFields(baseUrlV1: string, model: string): ClientConfigField[] {
  return [
    { label: 'Base URL', value: baseUrlV1 },
    { label: 'API Key', value: API_KEY_PLACEHOLDER },
    { label: 'Model', value: model }
  ];
}

export function getClientConfigs(input: { baseUrl: string; model?: string | undefined }): ClientConfigSnapshot {
  const normalized = normalizeBaseUrl(input.baseUrl);
  const model = input.model?.trim() || MODEL_PLACEHOLDER;
  const openAiFields = commonFields(normalized.baseUrlV1, model);

  return {
    ...normalized,
    model,
    apiKeyPlaceholder: API_KEY_PLACEHOLDER,
    items: [
      {
        id: 'openai-compatible',
        name: 'OpenAI-compatible 通用配置',
        description: '适用于 Open WebUI、Cursor、ChatGPT-Next-Web 等标准 OpenAI-compatible 客户端。',
        fields: openAiFields,
        files: [
          jsonFile('a2api-openai-compatible.json', {
            provider: 'openai-compatible',
            name: 'a2api',
            baseUrl: normalized.baseUrlV1,
            apiKey: API_KEY_PLACEHOLDER,
            model,
            modelsEndpoint: `${normalized.baseUrlV1}/models`
          })
        ]
      },
      {
        id: 'cherry-studio',
        name: 'Cherry Studio',
        description: '在模型提供商中选择 OpenAI-compatible，并填入 API 地址和 Key。',
        fields: openAiFields,
        files: [
          jsonFile('cherry-studio-a2api.json', {
            name: 'a2api',
            type: 'openai',
            apiHost: normalized.baseUrlV1,
            apiKey: API_KEY_PLACEHOLDER,
            models: [model]
          })
        ]
      },
      {
        id: 'roo-kilo-code',
        name: 'Roo Code / Kilo Code',
        description: '适用于支持 OpenAI Base URL 覆盖的 VS Code 类客户端。',
        fields: openAiFields,
        files: [
          jsonFile('roo-kilo-a2api.json', {
            provider: 'openai',
            openAiBaseUrl: normalized.baseUrlV1,
            openAiApiKey: API_KEY_PLACEHOLDER,
            model
          })
        ]
      },
      {
        id: 'claude-code',
        name: 'Claude Code',
        description: 'Claude Code 使用根域名，由客户端自动请求 `/v1/messages`。',
        fields: [
          { label: 'ANTHROPIC_BASE_URL', value: normalized.baseUrl },
          { label: 'ANTHROPIC_API_KEY', value: API_KEY_PLACEHOLDER },
          { label: 'ANTHROPIC_AUTH_TOKEN', value: API_KEY_PLACEHOLDER }
        ],
        files: [
          jsonFile('claude-settings.json', {
            env: {
              ANTHROPIC_BASE_URL: normalized.baseUrl,
              ANTHROPIC_API_KEY: API_KEY_PLACEHOLDER,
              ANTHROPIC_AUTH_TOKEN: API_KEY_PLACEHOLDER,
              CLAUDE_CODE_ATTRIBUTION_HEADER: '0',
              CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1'
            }
          })
        ]
      },
      {
        id: 'codex-cli',
        name: 'Codex CLI',
        description: '配置 a2api 为 OpenAI-compatible provider，认证写入 auth.json。',
        fields: openAiFields,
        files: [
          {
            filename: 'config.toml',
            language: 'toml',
            content: [
              `model = "${model}"`,
              'model_provider = "a2api"',
              '',
              '[model_providers.a2api]',
              'name = "a2api"',
              `base_url = "${normalized.baseUrlV1}"`
            ].join('\n')
          },
          jsonFile('auth.json', {
            OPENAI_API_KEY: API_KEY_PLACEHOLDER
          })
        ]
      },
      {
        id: 'claude-code-router',
        name: 'Claude Code Router',
        description: '使用 OpenAI transformer，把请求转到 a2api Chat Completions。',
        fields: [
          { label: 'api_base_url', value: `${normalized.baseUrlV1}/chat/completions` },
          { label: 'api_key', value: API_KEY_PLACEHOLDER },
          { label: 'default', value: `a2api,${model}` }
        ],
        files: [
          jsonFile('claude-code-router.json', {
            Providers: [
              {
                name: 'a2api',
                api_base_url: `${normalized.baseUrlV1}/chat/completions`,
                api_key: API_KEY_PLACEHOLDER,
                models: [model],
                transformer: { use: ['openai'] }
              }
            ],
            Router: {
              default: `a2api,${model}`
            }
          })
        ]
      },
      {
        id: 'cc-switch',
        name: 'CC Switch',
        description: '生成 OpenAI-compatible provider 条目，供 CC Switch 类工具导入或手动填写。',
        fields: openAiFields,
        files: [
          jsonFile('cc-switch-a2api.json', {
            providers: [
              {
                id: 'a2api',
                name: 'a2api',
                type: 'openai',
                base_url: normalized.baseUrlV1,
                api_key: API_KEY_PLACEHOLDER,
                models: [model]
              }
            ],
            default_provider: 'a2api'
          })
        ]
      }
    ]
  };
}
