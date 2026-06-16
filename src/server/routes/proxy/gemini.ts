import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getProxyAuthContext } from '../../middleware/auth.js';
import { getAvailableModels } from '../../services/tokenRouter.js';
import type { DownstreamRoutingPolicy } from '../../services/downstreamPolicy.js';
import { sendError } from '../../shared/errors.js';
import { proxyOpenAiEndpoint, type OpenAiProxyBody, type OpenAiProxyEndpointOptions } from './chat.js';

const geminiGenerateBodySchema = z.object({
  contents: z.array(z.unknown()).min(1),
  generationConfig: z.record(z.string(), z.unknown()).optional(),
  systemInstruction: z.unknown().optional()
}).passthrough();

type GeminiRouteParams = {
  geminiApiVersion?: string;
  modelAction: string;
};

type GeminiAction = 'generateContent' | 'streamGenerateContent' | 'countTokens';

type GeminiModelInfo = {
  name: string;
  displayName: string;
  supportedGenerationMethods: string[];
};

export async function geminiProxyRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1beta/models', listGeminiModels);
  app.get<{ Params: { geminiApiVersion: string } }>('/gemini/:geminiApiVersion/models', listGeminiModels);

  app.post<{ Params: GeminiRouteParams }>('/v1beta/models/:modelAction', async (request, reply) => {
    return handleGenerateContent(request, reply);
  });
  app.post<{ Params: GeminiRouteParams }>('/gemini/:geminiApiVersion/models/:modelAction', async (request, reply) => {
    return handleGenerateContent(request, reply);
  });
}

async function listGeminiModels(request: FastifyRequest, reply: FastifyReply) {
  const auth = getProxyAuthContext(request);
  if (!auth) return sendError(reply, 401, 'auth_error', 'Missing proxy auth context', 'missing_proxy_auth');
  const models = await getGeminiModels(auth.policy);
  return reply.send({ models });
}

async function handleGenerateContent(
  request: FastifyRequest<{ Params: GeminiRouteParams }>,
  reply: FastifyReply
) {
  const auth = getProxyAuthContext(request);
  if (!auth) return sendError(reply, 401, 'auth_error', 'Missing proxy auth context', 'missing_proxy_auth');

  const modelAction = request.params.modelAction;
  const parsedPath = parseModelAction(modelAction);
  if (!parsedPath) {
    return sendError(reply, 400, 'validation_error', 'Gemini model action must be generateContent, streamGenerateContent, or countTokens', 'unsupported_gemini_action');
  }
  if (parsedPath.action === 'countTokens') {
    return sendError(
      reply,
      501,
      'validation_error',
      'Gemini countTokens compatibility is not implemented for OpenAI-compatible upstreams',
      'unsupported_gemini_count_tokens'
    );
  }
  const parsedBody = geminiGenerateBodySchema.safeParse(request.body);
  if (!parsedBody.success) return sendError(reply, 400, 'validation_error', parsedBody.error.message, 'invalid_payload');

  const isStream = parsedPath.action === 'streamGenerateContent';
  const openAiBody = buildOpenAiBody(parsedPath.model, parsedBody.data, isStream);
  if (openAiBody.messages.length === 0) {
    return sendError(reply, 400, 'validation_error', 'contents must include text parts', 'invalid_payload');
  }

  const options: OpenAiProxyEndpointOptions = {
    downstreamPath: request.url.split('?')[0] || `/v1beta/models/${modelAction}`,
    upstreamPath: '/v1/chat/completions',
    transformPayload: (payload) => serializeOpenAiChatToGemini(payload, parsedPath.model)
  };
  if (isStream) {
    options.streamContentType = 'text/event-stream';
    options.transformStream = (body, context) => transformOpenAiChatStreamToGemini(body, context.requestedModel);
  }
  return proxyOpenAiEndpoint(openAiBody, auth.keyId, auth.policy, request.headers, reply, options);
}

async function getGeminiModels(policy: DownstreamRoutingPolicy): Promise<GeminiModelInfo[]> {
  const models = await getAvailableModels(policy);
  return models.map((item) => ({
    name: `models/${item.id}`,
    displayName: item.id,
    supportedGenerationMethods: ['generateContent', 'streamGenerateContent']
  }));
}

function parseModelAction(value: string): { model: string; action: GeminiAction } | null {
  const separatorIndex = value.lastIndexOf(':');
  if (separatorIndex <= 0) return null;
  const model = value.slice(0, separatorIndex).replace(/^models\//, '').trim();
  const action = value.slice(separatorIndex + 1).trim();
  if (!model || !isGeminiAction(action)) return null;
  return { model, action };
}

function isGeminiAction(value: string): value is GeminiAction {
  return value === 'generateContent' || value === 'streamGenerateContent' || value === 'countTokens';
}

function buildOpenAiBody(model: string, body: z.infer<typeof geminiGenerateBodySchema>, stream: boolean) {
  const messages = [
    ...extractSystemMessages(body.systemInstruction),
    ...body.contents.flatMap((item) => contentToOpenAiMessage(item))
  ];
  const generationConfig = body.generationConfig || {};
  const openAiBody: Record<string, unknown> = {
    model,
    messages,
    stream
  };
  copyGenerationConfig(generationConfig, openAiBody);
  return openAiBody as OpenAiProxyBody & { messages: Array<{ role: string; content: string }>; stream: boolean };
}

function extractSystemMessages(value: unknown): Array<{ role: string; content: string }> {
  const text = extractPartsText(value);
  return text ? [{ role: 'system', content: text }] : [];
}

function contentToOpenAiMessage(value: unknown): Array<{ role: string; content: string }> {
  if (!isRecord(value)) return [];
  const role = value.role === 'model' ? 'assistant' : 'user';
  const content = extractPartsText(value);
  return content ? [{ role, content }] : [];
}

function extractPartsText(value: unknown): string {
  if (!isRecord(value)) return '';
  const parts = Array.isArray(value.parts) ? value.parts : [];
  return parts
    .map((part) => isRecord(part) && typeof part.text === 'string' ? part.text.trim() : '')
    .filter(Boolean)
    .join('\n');
}

function copyGenerationConfig(input: Record<string, unknown>, output: Record<string, unknown>): void {
  if (typeof input.temperature === 'number') output.temperature = input.temperature;
  if (typeof input.topP === 'number') output.top_p = input.topP;
  if (typeof input.maxOutputTokens === 'number') output.max_tokens = Math.trunc(input.maxOutputTokens);
  if (Array.isArray(input.stopSequences)) output.stop = input.stopSequences;
}

function serializeOpenAiChatToGemini(payload: Record<string, unknown>, requestedModel: string): Record<string, unknown> {
  const firstChoice = Array.isArray(payload.choices) ? payload.choices[0] : null;
  const choice = isRecord(firstChoice) ? firstChoice : {};
  const message = isRecord(choice.message) ? choice.message : {};
  const content = typeof message.content === 'string' ? message.content : '';
  return {
    candidates: [
      {
        content: {
          role: 'model',
          parts: [{ text: content }]
        },
        finishReason: mapFinishReason(choice.finish_reason),
        index: 0
      }
    ],
    usageMetadata: buildUsageMetadata(payload.usage),
    modelVersion: typeof payload.model === 'string' ? payload.model : requestedModel
  };
}

async function* transformOpenAiChatStreamToGemini(
  body: AsyncIterable<Uint8Array>,
  requestedModel: string
): AsyncIterable<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = '';

  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let eventEnd = findSseEventEnd(buffer);
    while (eventEnd) {
      const rawEvent = buffer.slice(0, eventEnd.index);
      buffer = buffer.slice(eventEnd.index + eventEnd.length);
      const data = extractSseData(rawEvent);
      const payload = data && data !== '[DONE]' ? parseJsonRecord(data) : null;
      const geminiPayload = payload ? serializeOpenAiChatChunkToGemini(payload, requestedModel) : null;
      if (geminiPayload) {
        yield encoder.encode(`data: ${JSON.stringify(geminiPayload)}\n\n`);
      }
      eventEnd = findSseEventEnd(buffer);
    }
  }

  buffer += decoder.decode();
  const data = extractSseData(buffer);
  const payload = data && data !== '[DONE]' ? parseJsonRecord(data) : null;
  const geminiPayload = payload ? serializeOpenAiChatChunkToGemini(payload, requestedModel) : null;
  if (geminiPayload) {
    yield encoder.encode(`data: ${JSON.stringify(geminiPayload)}\n\n`);
  }
}

function serializeOpenAiChatChunkToGemini(payload: Record<string, unknown>, requestedModel: string): Record<string, unknown> | null {
  const firstChoice = Array.isArray(payload.choices) ? payload.choices[0] : null;
  const choice = isRecord(firstChoice) ? firstChoice : {};
  const delta = isRecord(choice.delta) ? choice.delta : {};
  const content = typeof delta.content === 'string' ? delta.content : '';
  const finishReason = mapOptionalFinishReason(choice.finish_reason);
  const usageMetadata = buildUsageMetadata(payload.usage);
  if (!content && !finishReason && !usageMetadata) return null;

  const response: Record<string, unknown> = {
    modelVersion: typeof payload.model === 'string' ? payload.model : requestedModel
  };
  if (content || finishReason) {
    response.candidates = [
      {
        content: {
          role: 'model',
          parts: content ? [{ text: content }] : []
        },
        finishReason,
        index: 0
      }
    ];
  }
  if (usageMetadata) response.usageMetadata = usageMetadata;
  return response;
}

function findSseEventEnd(value: string): { index: number; length: number } | null {
  const lfIndex = value.indexOf('\n\n');
  const crlfIndex = value.indexOf('\r\n\r\n');
  if (lfIndex === -1 && crlfIndex === -1) return null;
  if (lfIndex === -1) return { index: crlfIndex, length: 4 };
  if (crlfIndex === -1) return { index: lfIndex, length: 2 };
  return lfIndex < crlfIndex
    ? { index: lfIndex, length: 2 }
    : { index: crlfIndex, length: 4 };
}

function extractSseData(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trimStart())
    .join('\n')
    .trim();
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function buildUsageMetadata(value: unknown): Record<string, number> | undefined {
  if (!isRecord(value)) return undefined;
  const promptTokenCount = numberValue(value.prompt_tokens);
  const candidatesTokenCount = numberValue(value.completion_tokens);
  const totalTokenCount = numberValue(value.total_tokens);
  return {
    promptTokenCount,
    candidatesTokenCount,
    totalTokenCount: totalTokenCount || promptTokenCount + candidatesTokenCount
  };
}

function mapFinishReason(value: unknown): string {
  if (value === 'length') return 'MAX_TOKENS';
  if (value === 'content_filter') return 'SAFETY';
  if (value === 'tool_calls') return 'STOP';
  return 'STOP';
}

function mapOptionalFinishReason(value: unknown): string | undefined {
  return typeof value === 'string' ? mapFinishReason(value) : undefined;
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
