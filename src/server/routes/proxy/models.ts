import type { FastifyInstance } from 'fastify';
import { getProxyAuthContext } from '../../middleware/auth.js';
import { sendError } from '../../shared/errors.js';
import { getAvailableModels } from '../../services/tokenRouter.js';

export async function modelsProxyRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/models', async (request, reply) => {
    const auth = getProxyAuthContext(request);
    if (!auth) return sendError(reply, 401, 'auth_error', 'Missing proxy auth context', 'missing_proxy_auth');
    const data = await getAvailableModels(auth.policy);
    return {
      object: 'list',
      data
    };
  });
}
