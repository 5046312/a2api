import { fetch, ProxyAgent, type Headers } from 'undici';
import { config } from '../config.js';

const blockedHeaderNames = new Set([
  'host',
  'content-length',
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'cookie',
  'authorization',
  'x-api-key',
  'x-goog-api-key',
  'x-forwarded-for',
  'x-real-ip',
  'forwarded',
  'cf-connecting-ip',
  'true-client-ip'
]);

export function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

export function resolveOpenAiPath(baseUrl: string, path: string): string {
  const normalized = normalizeBaseUrl(baseUrl);
  if (/\/v\d+(?:\.\d+)?(?:beta)?$/i.test(normalized)) {
    return `${normalized}${path.replace(/^\/v1/, '')}`;
  }
  return `${normalized}${path}`;
}

export function safeHeaders(input: Record<string, string | string[] | undefined>): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    const lower = key.toLowerCase();
    if (blockedHeaderNames.has(lower)) continue;
    if (Array.isArray(value)) {
      const first = value.find((item) => item.trim());
      if (first) headers[key] = first;
      continue;
    }
    if (typeof value === 'string' && value.trim()) headers[key] = value;
  }
  return headers;
}

export function mergeCustomHeaders(headers: Record<string, string>, customHeaders: Record<string, string> | null): Record<string, string> {
  if (!customHeaders) return headers;
  const merged = { ...headers };
  for (const [key, value] of Object.entries(customHeaders)) {
    const lower = key.toLowerCase();
    if (blockedHeaderNames.has(lower)) continue;
    merged[key] = value;
  }
  return merged;
}

export function fetchDispatcher(proxyUrl?: string | null) {
  const finalProxyUrl = proxyUrl || config.systemProxyUrl;
  return finalProxyUrl ? new ProxyAgent(finalProxyUrl) : undefined;
}

export async function fetchJson<T>(
  url: string,
  options: {
    method?: string;
    token?: string | null;
    headers?: Record<string, string>;
    body?: unknown;
    proxyUrl?: string | null;
  } = {}
): Promise<{ status: number; data: T; headers: Headers }> {
  const dispatcher = fetchDispatcher(options.proxyUrl);
  const fetchOptions: NonNullable<Parameters<typeof fetch>[1]> = {
    method: options.method || 'GET',
    headers: {
      ...(options.headers || {}),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' })
    }
  };
  if (options.body !== undefined) fetchOptions.body = JSON.stringify(options.body);
  if (dispatcher) fetchOptions.dispatcher = dispatcher;
  const response = await fetch(url, fetchOptions);
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Upstream returned non-JSON response: ${text.slice(0, 160)}`);
  }
  if (!response.ok) {
    const message = typeof data === 'object' && data && 'error' in data
      ? JSON.stringify((data as { error: unknown }).error)
      : response.statusText;
    throw new Error(`Upstream ${response.status}: ${message}`);
  }
  return { status: response.status, data: data as T, headers: response.headers };
}
