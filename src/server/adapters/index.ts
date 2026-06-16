import { OpenAiCompatibleAdapter } from './openaiCompatible.js';
import { AnyRouterAdapter, ClaudeAdapter, CliProxyApiAdapter, DoneHubAdapter, OneHubAdapter, VeloeraAdapter } from './platformAdapters.js';
import type { PlatformAdapter, SitePlatform } from './types.js';

const adapters: PlatformAdapter[] = [
  new OpenAiCompatibleAdapter('openai'),
  new OpenAiCompatibleAdapter('new-api'),
  new OpenAiCompatibleAdapter('one-api'),
  new OneHubAdapter(),
  new DoneHubAdapter(),
  new VeloeraAdapter(),
  new AnyRouterAdapter(),
  new OpenAiCompatibleAdapter('sub2api'),
  new CliProxyApiAdapter(),
  new ClaudeAdapter()
];

export function getAdapter(platform: string): PlatformAdapter {
  const adapter = adapters.find((item) => item.platformName === platform);
  return adapter || new OpenAiCompatibleAdapter(platform as SitePlatform);
}

export async function detectPlatform(url: string): Promise<{ platform: SitePlatform | null; confidence: 'high' | 'medium' | 'none'; message: string }> {
  for (const adapter of adapters) {
    if (await adapter.detect(url)) {
      return {
        platform: adapter.platformName,
        confidence: 'high',
        message: `Detected ${adapter.platformName}`
      };
    }
  }

  return {
    platform: null,
    confidence: 'none',
    message: 'Could not detect platform. Please specify manually.'
  };
}

export type { SitePlatform } from './types.js';
