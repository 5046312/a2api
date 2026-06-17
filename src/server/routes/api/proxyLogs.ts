import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getProxyLog, listProxyLogs } from '../../services/proxyLogService.js';
import { getProxyDebugTraceDetail, listProxyDebugTraces } from '../../services/proxyDebugTraceService.js';
import { sendError } from '../../shared/errors.js';
import { compactObject } from '../../shared/object.js';
import { optionalBooleanQuery } from '../../shared/query.js';

export async function proxyLogsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/proxy-logs', async (request) => {
    const query = z.object({
      page: z.coerce.number().int().optional(),
      pageSize: z.coerce.number().int().optional(),
      status: z.string().optional(),
      model: z.string().optional(),
      siteId: z.coerce.number().int().optional(),
      accountId: z.coerce.number().int().optional(),
      downstreamApiKeyId: z.coerce.number().int().optional(),
      isStream: optionalBooleanQuery,
      from: z.string().optional(),
      to: z.string().optional()
    }).parse(request.query);
    return listProxyLogs(compactObject(query));
  });

  app.get('/api/proxy-logs/:id', async (request, reply) => {
    const params = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    const log = await getProxyLog(params.id);
    if (!log) return sendError(reply, 404, 'validation_error', 'Proxy log not found', 'proxy_log_not_found');
    return log;
  });

  app.get('/api/proxy-debug-traces', async (request) => {
    const query = z.object({
      page: z.coerce.number().int().optional(),
      pageSize: z.coerce.number().int().optional(),
      limit: z.coerce.number().int().optional(),
      requestedModel: z.string().trim().optional(),
      finalStatus: z.string().trim().optional()
    }).parse(request.query);
    return listProxyDebugTraces(compactObject(query));
  });

  app.get('/api/proxy-debug-traces/:id', async (request, reply) => {
    const params = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    const trace = await getProxyDebugTraceDetail(params.id);
    if (!trace) return sendError(reply, 404, 'validation_error', 'Proxy debug trace not found', 'proxy_debug_trace_not_found');
    return trace;
  });
}
