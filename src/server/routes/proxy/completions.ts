import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getProxyAuthContext } from '../../middleware/auth.js';
import { sendError } from '../../shared/errors.js';
import {
  openAiProxyBodySchema,
  proxyOpenAiEndpoint,
  type OpenAiProxyEndpointOptions
} from './chat.js';

const completionsBodySchema = openAiProxyBodySchema.extend({
  prompt: z.unknown().refine((value) => value !== undefined && value !== null, 'prompt is required')
});

const completionsProxyOptions: OpenAiProxyEndpointOptions = {
  downstreamPath: '/v1/completions',
  upstreamPath: '/v1/completions'
};

export async function completionsProxyRoutes(app: FastifyInstance): Promise<void> {
  app.post('/v1/completions', async (request, reply) => {
    const auth = getProxyAuthContext(request);
    if (!auth) return sendError(reply, 401, 'auth_error', 'Missing proxy auth context', 'missing_proxy_auth');
    const parsed = completionsBodySchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'validation_error', parsed.error.message, 'invalid_payload');
    return proxyOpenAiEndpoint(parsed.data, auth.keyId, auth.policy, request.headers, reply, completionsProxyOptions);
  });
}
