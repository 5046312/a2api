import type { FastifyInstance } from 'fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Buffer } from 'node:buffer';
import { fetch } from 'undici';
import { z } from 'zod';
import { config } from '../../config.js';
import {
  getMonitorConfig,
  getStoredLdohCookie,
  MONITOR_AUTH_COOKIE,
  monitorSessionCookie,
  updateMonitorConfig
} from '../../services/monitorService.js';
import { sendError } from '../../shared/errors.js';
import { fetchDispatcher } from '../../shared/http.js';

const LDOH_BASE_URL = 'https://ldoh.105117.xyz';

const monitorConfigPayloadSchema = z.object({
  ldohCookie: z.string().trim().nullable().optional()
});

function parseCookies(raw: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!raw) return cookies;
  for (const part of raw.split(';')) {
    const entry = part.trim();
    const index = entry.indexOf('=');
    if (index <= 0) continue;
    const key = entry.slice(0, index).trim();
    const value = entry.slice(index + 1).trim();
    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      // 容忍非标准编码 Cookie，避免监控代理入口被异常 Cookie 打成 500。
      cookies[key] = value;
    }
  }
  return cookies;
}

function ensureMonitorSession(request: FastifyRequest, reply: FastifyReply): boolean {
  const cookies = parseCookies(request.headers.cookie);
  if (cookies[MONITOR_AUTH_COOKIE] !== config.authToken) {
    reply.code(401).send({ error: 'Missing or invalid monitor session' });
    return false;
  }
  return true;
}

function resolveLdohProxyPath(request: FastifyRequest): string {
  const rawUrl = String(request.url || '');
  const cleanPath = rawUrl.split('?')[0] || '';
  const prefix = '/monitor-proxy/ldoh';
  if (cleanPath === prefix || cleanPath === `${prefix}/`) return '';
  if (cleanPath.startsWith(`${prefix}/`)) return cleanPath.slice(prefix.length + 1);
  return String((request.params as Record<string, unknown>)['*'] || '');
}

function rewriteProxyText(text: string): string {
  return text
    .replaceAll(`${LDOH_BASE_URL}/`, '/monitor-proxy/ldoh/')
    .replaceAll('https:\\/\\/ldoh.105117.xyz\\/', '\\/monitor-proxy\\/ldoh\\/')
    .replaceAll('src="/', 'src="/monitor-proxy/ldoh/')
    .replaceAll("src='/", "src='/monitor-proxy/ldoh/")
    .replaceAll('href="/', 'href="/monitor-proxy/ldoh/')
    .replaceAll("href='/", "href='/monitor-proxy/ldoh/")
    .replaceAll('action="/', 'action="/monitor-proxy/ldoh/')
    .replaceAll("action='/", "action='/monitor-proxy/ldoh/")
    .replaceAll('"/_next/', '"/monitor-proxy/ldoh/_next/')
    .replaceAll("'/_next/", "'/monitor-proxy/ldoh/_next/")
    .replaceAll('"\\/api/', '"\\/monitor-proxy\\/ldoh\\/api/')
    .replaceAll("'/api/", "'/monitor-proxy/ldoh/api/")
    .replaceAll('"/api/', '"/monitor-proxy/ldoh/api/');
}

function rewriteLocationHeader(location: string | null): string | null {
  if (!location) return null;
  if (location.startsWith(`${LDOH_BASE_URL}/`)) {
    return `/monitor-proxy/ldoh/${location.slice(LDOH_BASE_URL.length + 1)}`;
  }
  if (location.startsWith('/')) return `/monitor-proxy/ldoh${location}`;
  return location;
}

function resolveProxyBody(request: FastifyRequest): NonNullable<Parameters<typeof fetch>[1]>['body'] | undefined {
  const method = request.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD') return undefined;
  if (request.body === undefined || request.body === null) return undefined;
  if (typeof request.body === 'string' || request.body instanceof Buffer) return request.body;
  return JSON.stringify(request.body);
}

async function handleLdohProxy(request: FastifyRequest, reply: FastifyReply) {
  if (!ensureMonitorSession(request, reply)) return;

  const storedCookie = getStoredLdohCookie();
  if (!storedCookie) return reply.code(400).send('LDOH cookie not configured');

  const targetUrl = new URL(`${LDOH_BASE_URL}/${resolveLdohProxyPath(request)}`);
  for (const [key, value] of Object.entries(request.query as Record<string, unknown>)) {
    if (value === null || value === undefined) continue;
    targetUrl.searchParams.set(key, String(value));
  }

  const headers: Record<string, string> = {
    cookie: storedCookie,
    accept: String(request.headers.accept || '*/*'),
    'accept-language': String(request.headers['accept-language'] || 'zh-CN,zh;q=0.9,en;q=0.8'),
    'user-agent': String(request.headers['user-agent'] || 'a2api-monitor-proxy/1.0')
  };
  if (request.headers['content-type']) headers['content-type'] = String(request.headers['content-type']);
  if (request.headers.referer) headers.referer = String(request.headers.referer).replace('/monitor-proxy/ldoh', '');

  const fetchOptions: NonNullable<Parameters<typeof fetch>[1]> = {
    method: request.method.toUpperCase(),
    headers,
    redirect: 'manual'
  };
  const body = resolveProxyBody(request);
  if (body !== undefined) fetchOptions.body = body;
  const dispatcher = fetchDispatcher();
  if (dispatcher) fetchOptions.dispatcher = dispatcher;

  const upstream = await fetch(targetUrl, fetchOptions);
  const location = rewriteLocationHeader(upstream.headers.get('location'));
  const contentType = upstream.headers.get('content-type') || '';
  if (location) reply.header('location', location);
  if (contentType) reply.header('content-type', contentType);
  const cacheControl = upstream.headers.get('cache-control');
  if (cacheControl) reply.header('cache-control', cacheControl);
  reply.code(upstream.status);

  if (
    contentType.includes('text/html') ||
    contentType.includes('application/javascript') ||
    contentType.includes('text/javascript') ||
    contentType.includes('text/css') ||
    contentType.includes('application/json')
  ) {
    return reply.send(rewriteProxyText(await upstream.text()));
  }

  return reply.send(Buffer.from(await upstream.arrayBuffer()));
}

export async function monitorRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/monitor/config', async () => getMonitorConfig());

  app.put('/api/monitor/config', async (request, reply) => {
    const parsed = monitorConfigPayloadSchema.safeParse(request.body ?? {});
    if (!parsed.success) return sendError(reply, 400, 'validation_error', parsed.error.message, 'invalid_payload');
    try {
      return updateMonitorConfig(parsed.data);
    } catch (err) {
      return sendError(reply, 400, 'validation_error', err instanceof Error ? err.message : 'Invalid monitor config', 'invalid_payload');
    }
  });

  app.post('/api/monitor/session', async (_, reply) => {
    reply.header('Set-Cookie', monitorSessionCookie());
    return { ok: true };
  });

  app.all('/monitor-proxy/ldoh', handleLdohProxy);
  app.all('/monitor-proxy/ldoh/', handleLdohProxy);
  app.all('/monitor-proxy/ldoh/*', handleLdohProxy);
}
