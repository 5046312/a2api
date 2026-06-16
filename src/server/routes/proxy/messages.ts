import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getProxyAuthContext } from '../../middleware/auth.js';
import { sendError } from '../../shared/errors.js';
import { openAiProxyBodySchema, proxyOpenAiEndpoint, type OpenAiProxyEndpointOptions } from './chat.js';

const claudeMessagesBodySchema = openAiProxyBodySchema.extend({
  messages: z.array(z.unknown()).min(1)
});

const claudeMessagesProxyOptions: OpenAiProxyEndpointOptions = {
  downstreamPath: '/v1/messages',
  upstreamPath: '/v1/messages',
  headerMode: 'anthropic'
};

const claudeCountTokensProxyOptions: OpenAiProxyEndpointOptions = {
  downstreamPath: '/v1/messages/count_tokens',
  upstreamPath: '/v1/messages/count_tokens?beta=true',
  headerMode: 'anthropic',
  extraAnthropicBetas: ['token-counting-2024-11-01'],
  transformBody: sanitizeClaudeCountTokensBody
};

export async function claudeMessagesProxyRoutes(app: FastifyInstance): Promise<void> {
  app.post('/v1/messages', async (request, reply) => {
    const auth = getProxyAuthContext(request);
    if (!auth) return sendError(reply, 401, 'auth_error', 'Missing proxy auth context', 'missing_proxy_auth');
    const parsed = claudeMessagesBodySchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'validation_error', parsed.error.message, 'invalid_payload');
    return proxyOpenAiEndpoint(parsed.data, auth.keyId, auth.policy, request.headers, reply, claudeMessagesProxyOptions);
  });

  app.post('/v1/messages/count_tokens', async (request, reply) => {
    const auth = getProxyAuthContext(request);
    if (!auth) return sendError(reply, 401, 'auth_error', 'Missing proxy auth context', 'missing_proxy_auth');
    const parsed = claudeMessagesBodySchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'validation_error', parsed.error.message, 'invalid_payload');
    return proxyOpenAiEndpoint(
      { ...parsed.data, stream: false },
      auth.keyId,
      auth.policy,
      request.headers,
      reply,
      claudeCountTokensProxyOptions
    );
  });
}

function sanitizeClaudeCountTokensBody(body: Record<string, unknown>): Record<string, unknown> {
  const next = { ...body };
  // count_tokens 不接受生成参数和流式参数，只保留计数需要的消息 / 工具上下文。
  delete next.max_tokens;
  delete next.maxTokens;
  delete next.stream;
  delete next.stream_options;
  return next;
}
