import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sendError } from '../../shared/errors.js';
import { compactObject } from '../../shared/object.js';
import {
  batchUpdateSites,
  createSite,
  createSiteEndpoint,
  deleteSite,
  deleteSiteEndpoint,
  detectSite,
  listSiteAvailableModels,
  listSiteDisabledModels,
  listSiteEndpoints,
  listSites,
  siteBatchPayloadSchema,
  siteDisabledModelsPayloadSchema,
  siteEndpointPayloadSchema,
  sitePayloadSchema,
  updateSite,
  updateSiteDisabledModels,
  updateSiteEndpoint
} from '../../services/siteService.js';
import { rebuildRoutes } from '../../services/routeRefreshService.js';

const listQuerySchema = z.object({
  status: z.string().optional(),
  platform: z.string().optional(),
  keyword: z.string().optional(),
  page: z.coerce.number().int().optional(),
  pageSize: z.coerce.number().int().optional()
});

const idParamsSchema = z.object({ id: z.coerce.number().int().positive() });
const endpointIdParamsSchema = z.object({ endpointId: z.coerce.number().int().positive() });

export async function sitesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/sites', async (request) => listSites(compactObject(listQuerySchema.parse(request.query))));

  app.post('/api/sites', async (request, reply) => {
    const parsed = sitePayloadSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'validation_error', parsed.error.message, 'invalid_payload');
    try {
      return await createSite(parsed.data);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Create site failed';
      if (message.includes('UNIQUE')) return sendError(reply, 409, 'validation_error', 'Site url already exists', 'site_exists');
      return sendError(reply, 400, 'validation_error', message, 'create_site_failed');
    }
  });

  app.put('/api/sites/:id', async (request, reply) => {
    const params = idParamsSchema.parse(request.params);
    const parsed = sitePayloadSchema.partial().safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'validation_error', parsed.error.message, 'invalid_payload');
    const site = await updateSite(params.id, compactObject(parsed.data));
    if (!site) return sendError(reply, 404, 'validation_error', 'Site not found', 'site_not_found');
    await rebuildRoutes({ preserveManual: true });
    return site;
  });

  app.delete('/api/sites/:id', async (request, reply) => {
    const params = idParamsSchema.parse(request.params);
    const deleted = await deleteSite(params.id);
    if (!deleted) return sendError(reply, 404, 'validation_error', 'Site not found', 'site_not_found');
    await rebuildRoutes({ preserveManual: true });
    return { ok: true };
  });

  app.post('/api/sites/batch', async (request, reply) => {
    const parsed = siteBatchPayloadSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'validation_error', parsed.error.message, 'invalid_payload');
    const result = await batchUpdateSites(parsed.data);
    const routeRebuilt = result.successIds.length > 0;
    if (routeRebuilt) await rebuildRoutes({ preserveManual: true });
    return { ...result, routeRebuilt };
  });

  app.get('/api/sites/:id/endpoints', async (request, reply) => {
    const params = idParamsSchema.parse(request.params);
    const endpoints = await listSiteEndpoints(params.id);
    if (!endpoints) return sendError(reply, 404, 'validation_error', 'Site not found', 'site_not_found');
    return { items: endpoints, total: endpoints.length };
  });

  app.post('/api/sites/:id/endpoints', async (request, reply) => {
    const params = idParamsSchema.parse(request.params);
    const parsed = siteEndpointPayloadSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'validation_error', parsed.error.message, 'invalid_payload');
    try {
      const endpoint = await createSiteEndpoint(params.id, parsed.data);
      if (!endpoint) return sendError(reply, 404, 'validation_error', 'Site not found', 'site_not_found');
      return endpoint;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Create site endpoint failed';
      if (message.includes('UNIQUE')) return sendError(reply, 409, 'validation_error', 'Endpoint url already exists', 'endpoint_exists');
      return sendError(reply, 400, 'validation_error', message, 'create_endpoint_failed');
    }
  });

  app.put('/api/sites/endpoints/:endpointId', async (request, reply) => {
    const params = endpointIdParamsSchema.parse(request.params);
    const parsed = siteEndpointPayloadSchema.partial().safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'validation_error', parsed.error.message, 'invalid_payload');
    try {
      const endpoint = await updateSiteEndpoint(params.endpointId, compactObject(parsed.data));
      if (!endpoint) return sendError(reply, 404, 'validation_error', 'Endpoint not found', 'endpoint_not_found');
      return endpoint;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Update site endpoint failed';
      if (message.includes('UNIQUE')) return sendError(reply, 409, 'validation_error', 'Endpoint url already exists', 'endpoint_exists');
      return sendError(reply, 400, 'validation_error', message, 'update_endpoint_failed');
    }
  });

  app.delete('/api/sites/endpoints/:endpointId', async (request, reply) => {
    const params = endpointIdParamsSchema.parse(request.params);
    const deleted = await deleteSiteEndpoint(params.endpointId);
    if (!deleted) return sendError(reply, 404, 'validation_error', 'Endpoint not found', 'endpoint_not_found');
    return { ok: true };
  });

  app.get('/api/sites/:id/disabled-models', async (request, reply) => {
    const params = idParamsSchema.parse(request.params);
    const result = await listSiteDisabledModels(params.id);
    if (!result) return sendError(reply, 404, 'validation_error', 'Site not found', 'site_not_found');
    return result;
  });

  app.put('/api/sites/:id/disabled-models', async (request, reply) => {
    const params = idParamsSchema.parse(request.params);
    const parsed = siteDisabledModelsPayloadSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'validation_error', parsed.error.message, 'invalid_payload');
    const result = await updateSiteDisabledModels(params.id, parsed.data);
    if (!result) return sendError(reply, 404, 'validation_error', 'Site not found', 'site_not_found');
    await rebuildRoutes({ preserveManual: true });
    return { ...result, routeRebuilt: true };
  });

  app.get('/api/sites/:id/available-models', async (request, reply) => {
    const params = idParamsSchema.parse(request.params);
    const result = await listSiteAvailableModels(params.id);
    if (!result) return sendError(reply, 404, 'validation_error', 'Site not found', 'site_not_found');
    return result;
  });

  app.post('/api/sites/detect', async (request, reply) => {
    const parsed = z.object({ url: z.string().url() }).safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'validation_error', parsed.error.message, 'invalid_payload');
    return detectSite(parsed.data.url);
  });
}
