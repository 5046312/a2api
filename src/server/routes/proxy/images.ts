import { Blob } from 'node:buffer';
import type { FastifyInstance } from 'fastify';
import { FormData } from 'undici';
import { z } from 'zod';
import { getProxyAuthContext } from '../../middleware/auth.js';
import { sendError } from '../../shared/errors.js';
import { proxyOpenAiEndpoint, type OpenAiProxyEndpointOptions } from './chat.js';
import { ensureMultipartBufferParser, parseMultipartFormData, type MultipartFile, type MultipartFormData } from './multipart.js';

const imageGenerationsBodySchema = z.object({
  model: z.string().trim().min(1).optional(),
  prompt: z.string().trim().min(1),
  stream: z.boolean().optional()
}).passthrough();

const imageGenerationsProxyOptions: OpenAiProxyEndpointOptions = {
  downstreamPath: '/v1/images/generations',
  upstreamPath: '/v1/images/generations',
  transformBody: sanitizeImageGenerationsBody
};

export async function imagesProxyRoutes(app: FastifyInstance): Promise<void> {
  ensureMultipartBufferParser(app);

  app.post('/v1/images/generations', async (request, reply) => {
    const auth = getProxyAuthContext(request);
    if (!auth) return sendError(reply, 401, 'auth_error', 'Missing proxy auth context', 'missing_proxy_auth');
    const parsed = imageGenerationsBodySchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'validation_error', parsed.error.message, 'invalid_payload');
    if (parsed.data.stream) {
      return sendError(reply, 400, 'validation_error', 'stream is not supported on /v1/images/generations', 'stream_not_supported');
    }
    return proxyOpenAiEndpoint(
      { ...parsed.data, model: parsed.data.model || 'gpt-image-1', stream: false },
      auth.keyId,
      auth.policy,
      request.headers,
      reply,
      imageGenerationsProxyOptions
    );
  });

  app.post('/v1/images/edits', async (request, reply) => {
    const auth = getProxyAuthContext(request);
    if (!auth) return sendError(reply, 401, 'auth_error', 'Missing proxy auth context', 'missing_proxy_auth');
    const formData = await parseMultipartFormData(request);
    if (!formData) {
      return sendError(reply, 400, 'validation_error', 'multipart/form-data with image and prompt fields is required', 'invalid_payload');
    }

    const prompt = getStringField(formData, 'prompt');
    const image = formData.get('image');
    if (!prompt) return sendError(reply, 400, 'validation_error', 'prompt field is required', 'invalid_payload');
    if (!isMultipartFile(image)) return sendError(reply, 400, 'validation_error', 'image field is required', 'invalid_payload');
    if (isTruthyFormValue(formData.get('stream'))) {
      return sendError(reply, 400, 'validation_error', 'stream is not supported on /v1/images/edits', 'stream_not_supported');
    }

    const requestedModel = getStringField(formData, 'model') || 'gpt-image-1';
    const options = buildImageEditsProxyOptions(formData);
    return proxyOpenAiEndpoint(
      { model: requestedModel, stream: false },
      auth.keyId,
      auth.policy,
      request.headers,
      reply,
      options
    );
  });

  app.post('/v1/images/variations', async (request, reply) => {
    const auth = getProxyAuthContext(request);
    if (!auth) return sendError(reply, 401, 'auth_error', 'Missing proxy auth context', 'missing_proxy_auth');
    const formData = await parseMultipartFormData(request);
    if (!formData) {
      return sendError(reply, 400, 'validation_error', 'multipart/form-data with an image field is required', 'invalid_payload');
    }

    const image = formData.get('image');
    if (!isMultipartFile(image)) return sendError(reply, 400, 'validation_error', 'image field is required', 'invalid_payload');
    if (isTruthyFormValue(formData.get('stream'))) {
      return sendError(reply, 400, 'validation_error', 'stream is not supported on /v1/images/variations', 'stream_not_supported');
    }

    const requestedModel = getStringField(formData, 'model') || 'gpt-image-1';
    const options = buildMultipartImageProxyOptions(formData, '/v1/images/variations');
    return proxyOpenAiEndpoint(
      { model: requestedModel, stream: false },
      auth.keyId,
      auth.policy,
      request.headers,
      reply,
      options
    );
  });
}

function sanitizeImageGenerationsBody(body: Record<string, unknown>): Record<string, unknown> {
  const next = { ...body };
  // Images generations 是非流式接口，避免把客户端误传的 stream 字段转给上游。
  delete next.stream;
  delete next.stream_options;
  return next;
}

function buildImageEditsProxyOptions(formData: MultipartFormData): OpenAiProxyEndpointOptions {
  return buildMultipartImageProxyOptions(formData, '/v1/images/edits');
}

function buildMultipartImageProxyOptions(formData: MultipartFormData, path: string): OpenAiProxyEndpointOptions {
  return {
    downstreamPath: path,
    upstreamPath: path,
    buildUpstreamRequest: async (body) => ({
      body: await cloneImageFormData(formData, String(body.model || 'gpt-image-1')),
      contentType: null
    })
  };
}

async function cloneImageFormData(formData: MultipartFormData, upstreamModel: string): Promise<FormData> {
  const next = new FormData();
  for (const [key, value] of formData.entries()) {
    if (key === 'model' || key === 'stream' || key === 'stream_options') continue;
    if (isMultipartFile(value)) {
      const buffer = Buffer.from(await value.arrayBuffer());
      const blob = new Blob([buffer], { type: value.type || 'application/octet-stream' });
      next.append(key, blob, value.name || 'upload.bin');
    } else {
      next.append(key, value);
    }
  }
  // 命中的真实上游模型必须覆盖客户端传入模型。
  next.set('model', upstreamModel);
  return next;
}

function getStringField(formData: MultipartFormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

function isTruthyFormValue(value: string | MultipartFile | null): boolean {
  return typeof value === 'string' && value.trim().toLowerCase() === 'true';
}

function isMultipartFile(value: unknown): value is MultipartFile {
  return typeof value === 'object'
    && value !== null
    && typeof (value as MultipartFile).arrayBuffer === 'function';
}
