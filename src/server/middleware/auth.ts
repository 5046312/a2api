import { isIP } from 'node:net';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { sendError } from '../shared/errors.js';
import { authorizeDownstreamToken, consumeManagedKeyRequest } from '../services/downstreamKeyService.js';
import type { DownstreamRoutingPolicy } from '../services/downstreamPolicy.js';
import {
  clearAdminAuthFailures,
  getAdminAuthRateLimit,
  recordAdminAuthFailure,
  type RateLimitResult
} from './rateLimit.js';

export type ProxyAuthContext = {
  token: string;
  source: 'managed' | 'global';
  keyId: number | null;
  keyName: string;
  policy: DownstreamRoutingPolicy;
};

export type ProxyResourceOwner = {
  ownerType: 'managed_key' | 'global_proxy_token';
  ownerId: string;
};

const proxyAuthContextByRequest = new WeakMap<FastifyRequest, ProxyAuthContext>();

function normalizeIp(rawIp: string | null | undefined): string {
  const ip = (rawIp || '').trim();
  if (!ip) return '';
  if (ip.startsWith('::ffff:')) return ip.slice('::ffff:'.length);
  if (ip === '::1') return '127.0.0.1';
  return ip;
}

function isAllowedIp(ip: string): boolean {
  if (config.adminIpAllowlist.length === 0) return true;
  const normalized = normalizeIp(ip);
  return config.adminIpAllowlist.some((entry) => {
    const item = normalizeIp(entry);
    return isIP(item) > 0 && item === normalized;
  });
}

function sendAdminRateLimit(reply: FastifyReply, result: RateLimitResult) {
  reply.header('Retry-After', String(result.retryAfterSec));
  return sendError(reply, 429, 'auth_error', 'Too many failed admin auth attempts', 'admin_auth_rate_limited');
}

export async function adminAuthMiddleware(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!isAllowedIp(request.ip)) {
    sendError(reply, 403, 'auth_error', 'IP not allowed', 'ip_not_allowed');
    return;
  }

  const currentLimit = getAdminAuthRateLimit(request.ip);
  if (currentLimit.limited) {
    sendAdminRateLimit(reply, currentLimit);
    return;
  }

  const header = typeof request.headers.authorization === 'string' ? request.headers.authorization : '';
  const token = header.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    const failure = recordAdminAuthFailure(request.ip);
    if (failure.limited) {
      sendAdminRateLimit(reply, failure);
      return;
    }
    sendError(reply, 401, 'auth_error', 'Missing Authorization header', 'missing_authorization');
    return;
  }
  if (token !== config.authToken) {
    const failure = recordAdminAuthFailure(request.ip);
    if (failure.limited) {
      sendAdminRateLimit(reply, failure);
      return;
    }
    sendError(reply, 403, 'auth_error', 'Invalid token', 'invalid_token');
    return;
  }
  clearAdminAuthFailures(request.ip);
}

export async function proxyAuthMiddleware(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = typeof request.headers.authorization === 'string' ? request.headers.authorization : '';
  const bearer = header.replace(/^Bearer\s+/i, '').trim();
  const apiKey = typeof request.headers['x-api-key'] === 'string' ? request.headers['x-api-key'].trim() : '';
  const googApiKey = typeof request.headers['x-goog-api-key'] === 'string' ? request.headers['x-goog-api-key'].trim() : '';
  const query = request.query && typeof request.query === 'object' ? (request.query as Record<string, unknown>) : {};
  const queryKey = typeof query.key === 'string' ? query.key.trim() : '';
  const token = bearer || apiKey || googApiKey || queryKey;

  if (!token) {
    sendError(reply, 401, 'auth_error', 'Missing proxy token', 'missing_proxy_token');
    return;
  }

  const result = await authorizeDownstreamToken(token);
  if (!result.ok) {
    sendError(reply, result.statusCode, 'auth_error', result.error, 'invalid_proxy_token');
    return;
  }

  if (result.source === 'managed' && result.key) {
    await consumeManagedKeyRequest(result.key.id);
  }

  proxyAuthContextByRequest.set(request, {
    token: result.token,
    source: result.source,
    keyId: result.key?.id ?? null,
    keyName: result.key?.name ?? 'global',
    policy: result.policy
  });
}

export function getProxyAuthContext(request: FastifyRequest): ProxyAuthContext | null {
  return proxyAuthContextByRequest.get(request) ?? null;
}

export function getProxyResourceOwner(request: FastifyRequest): ProxyResourceOwner | null {
  const auth = getProxyAuthContext(request);
  if (!auth) return null;
  if (auth.source === 'managed' && auth.keyId !== null) {
    return { ownerType: 'managed_key', ownerId: String(auth.keyId) };
  }
  return { ownerType: 'global_proxy_token', ownerId: 'global' };
}
