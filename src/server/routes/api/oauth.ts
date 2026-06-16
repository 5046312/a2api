import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { deleteOAuthConnection, listOAuthConnections, setOAuthConnectionEnabled } from '../../services/oauthConnectionService.js';
import { listOAuthProviders } from '../../services/oauthProviderService.js';
import {
  completeOAuthSessionFromCallback,
  getOAuthSession,
  importOAuthCredentials,
  refreshOAuthConnection,
  refreshOAuthConnectionQuota,
  startOAuthSession
} from '../../services/oauthSessionService.js';
import { rebuildRoutes } from '../../services/routeRefreshService.js';
import { sendError } from '../../shared/errors.js';
import { compactObject } from '../../shared/object.js';

const connectionListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional()
});
const accountIdParamsSchema = z.object({ accountId: z.coerce.number().int().positive() });
const connectionStatusPayloadSchema = z.object({ enabled: z.boolean() });
const providerParamsSchema = z.object({ provider: z.enum(['codex', 'claude', 'gemini-cli', 'antigravity']) });
const sessionParamsSchema = z.object({ state: z.string().trim().min(1) });
const sessionStartPayloadSchema = z.object({
  siteId: z.coerce.number().int().positive().optional().nullable(),
  projectId: z.string().trim().optional().nullable(),
  proxyUrl: z.string().trim().optional().nullable(),
  callbackBaseUrl: z.string().trim().optional().nullable()
});
const manualCallbackPayloadSchema = z.object({
  callbackUrl: z.string().trim().min(1)
});

export async function oauthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/oauth/providers', async () => listOAuthProviders());

  app.post('/api/oauth/providers/:provider/start', async (request, reply) => {
    const params = providerParamsSchema.parse(request.params);
    const parsed = sessionStartPayloadSchema.safeParse(request.body ?? {});
    if (!parsed.success) return sendError(reply, 400, 'validation_error', parsed.error.message, 'invalid_payload');
    return startOAuthSession({ provider: params.provider, ...compactObject(parsed.data) });
  });

  app.get('/api/oauth/sessions/:state', async (request, reply) => {
    const params = sessionParamsSchema.parse(request.params);
    const session = getOAuthSession(params.state);
    if (!session) return sendError(reply, 404, 'validation_error', 'OAuth session not found', 'oauth_session_not_found');
    return session;
  });

  app.post('/api/oauth/sessions/:state/manual-callback', async (request, reply) => {
    const params = sessionParamsSchema.parse(request.params);
    const parsed = manualCallbackPayloadSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'validation_error', parsed.error.message, 'invalid_payload');
    const session = await completeOAuthSessionFromCallback(params.state, parsed.data.callbackUrl);
    if (!session) return sendError(reply, 404, 'validation_error', 'OAuth session not found', 'oauth_session_not_found');
    return session;
  });

  app.get('/api/oauth/callback/:provider', async (request, reply) => {
    const query = z.object({ state: z.string().trim().min(1) }).safeParse(request.query);
    if (!query.success) return sendError(reply, 400, 'validation_error', 'state is required', 'missing_oauth_state');
    const session = await completeOAuthSessionFromCallback(query.data.state, request.url);
    if (!session) return sendError(reply, 404, 'validation_error', 'OAuth session not found', 'oauth_session_not_found');
    return session;
  });

  app.get('/api/oauth/connections', async (request, reply) => {
    const parsed = connectionListQuerySchema.safeParse(request.query);
    if (!parsed.success) return sendError(reply, 400, 'validation_error', parsed.error.message, 'invalid_payload');
    return listOAuthConnections(compactObject(parsed.data));
  });

  app.patch('/api/oauth/connections/:accountId', async (request, reply) => {
    const params = accountIdParamsSchema.parse(request.params);
    const parsed = connectionStatusPayloadSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'validation_error', parsed.error.message, 'invalid_payload');
    const connection = await setOAuthConnectionEnabled(params.accountId, parsed.data.enabled);
    if (!connection) return sendError(reply, 404, 'validation_error', 'OAuth connection not found', 'oauth_connection_not_found');
    await rebuildRoutes({ preserveManual: true });
    return { ...connection, routeRebuilt: true };
  });

  app.post('/api/oauth/connections/:accountId/refresh', async (request, reply) => {
    const params = accountIdParamsSchema.parse(request.params);
    const result = await refreshOAuthConnection(params.accountId);
    if (!result) return sendError(reply, 404, 'validation_error', 'OAuth connection not found', 'oauth_connection_not_found');
    return result;
  });

  app.post('/api/oauth/connections/:accountId/quota', async (request, reply) => {
    const params = accountIdParamsSchema.parse(request.params);
    try {
      const result = await refreshOAuthConnectionQuota(params.accountId);
      if (!result) return sendError(reply, 404, 'validation_error', 'OAuth connection not found', 'oauth_connection_not_found');
      return result;
    } catch (error) {
      return sendError(reply, 400, 'validation_error', error instanceof Error ? error.message : 'OAuth quota refresh failed', 'oauth_quota_failed');
    }
  });

  app.delete('/api/oauth/connections/:accountId', async (request, reply) => {
    const params = accountIdParamsSchema.parse(request.params);
    const deleted = await deleteOAuthConnection(params.accountId);
    if (!deleted) return sendError(reply, 404, 'validation_error', 'OAuth connection not found', 'oauth_connection_not_found');
    await rebuildRoutes({ preserveManual: true });
    return { ok: true, routeRebuilt: true };
  });

  app.post('/api/oauth/import', async (request, reply) => {
    try {
      return await importOAuthCredentials(request.body);
    } catch (error) {
      return sendError(reply, 400, 'validation_error', error instanceof Error ? error.message : 'OAuth import failed', 'oauth_import_failed');
    }
  });
}
