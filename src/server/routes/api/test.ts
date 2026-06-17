import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { GLOBAL_ROUTING_POLICY } from '../../services/downstreamPolicy.js';
import { consumeManagedKeyRequest, getDownstreamKeyPolicyById } from '../../services/downstreamKeyService.js';
import { sendError } from '../../shared/errors.js';
import { chatBodySchema, proxyChat } from '../proxy/chat.js';

const testChatBodySchema = chatBodySchema.extend({
  downstreamApiKeyId: z.coerce.number().int().positive().optional().nullable(),
  forcedChannelId: z.coerce.number().int().positive().optional().nullable()
});

export async function testRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/test/chat', async (request, reply) => {
    const parsed = testChatBodySchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'validation_error', parsed.error.message, 'invalid_payload');
    if (parsed.data.stream) {
      return sendError(reply, 400, 'validation_error', 'Stream test is not supported by /api/test/chat', 'stream_not_supported');
    }
    const { downstreamApiKeyId, forcedChannelId, ...chatBody } = parsed.data;
    if (downstreamApiKeyId) {
      const keyResult = await getDownstreamKeyPolicyById(downstreamApiKeyId);
      if (!keyResult.ok) return sendError(reply, keyResult.statusCode, 'auth_error', keyResult.error, keyResult.code);
      await consumeManagedKeyRequest(keyResult.key.id);
      return proxyChat(
        { ...chatBody, stream: false },
        keyResult.key.id,
        keyResult.policy,
        request.headers,
        reply,
        { forcedChannelId: forcedChannelId ?? null, includeDebugTraceId: true }
      );
    }
    // 管理端测试入口复用代理核心，避免测试路径和真实代理出现两套模型选择逻辑。
    return proxyChat(
      { ...chatBody, stream: false },
      null,
      GLOBAL_ROUTING_POLICY,
      request.headers,
      reply,
      { forcedChannelId: forcedChannelId ?? null, includeDebugTraceId: true }
    );
  });
}
