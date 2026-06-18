import { Blob } from 'node:buffer';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { fetch, FormData, type Headers, type Response } from 'undici';
import { z } from 'zod';
import { config } from '../../config.js';
import { getProxyAuthContext } from '../../middleware/auth.js';
import { recordManagedKeyCostUsage } from '../../services/downstreamKeyService.js';
import { createProxyDebugTrace, finalizeProxyDebugTrace, recordProxyDebugAttempt } from '../../services/proxyDebugTraceService.js';
import { createPendingProxyLog, finalizeProxyLog } from '../../services/proxyLogService.js';
import { recordChannelFailure, recordChannelSuccess, selectChannel, type SelectedChannel } from '../../services/tokenRouter.js';
import {
  buildProxyVideoTaskTokenRef,
  deleteProxyVideoTaskByPublicId,
  getProxyVideoTaskByPublicId,
  refreshProxyVideoTaskSnapshot,
  resolveProxyVideoTaskCredential,
  saveProxyVideoTask,
  type ProxyVideoTaskCredential,
  type ProxyVideoTaskRecord
} from '../../services/proxyVideoTaskService.js';
import { fetchDispatcher, mergeCustomHeaders, resolveOpenAiPath, safeHeaders } from '../../shared/http.js';
import { sendError } from '../../shared/errors.js';
import { ensureMultipartBufferParser, parseMultipartFormData, type MultipartFile, type MultipartFormData } from './multipart.js';

type UpstreamRequestBody = NonNullable<Parameters<typeof fetch>[1]>['body'];
type VideoTaskRequest = FastifyRequest<{ Params: { id: string } }>;

type VideoCreateInput = {
  requestedModel: string;
  formData: MultipartFormData | null;
  jsonBody: Record<string, unknown> | null;
};

const videoCreateBodySchema = z.object({
  model: z.string().trim().min(1),
  stream: z.boolean().optional()
}).passthrough();

export async function videosProxyRoutes(app: FastifyInstance): Promise<void> {
  ensureMultipartBufferParser(app);

  app.post('/v1/videos', async (request, reply) => {
    const auth = getProxyAuthContext(request);
    if (!auth) return sendError(reply, 401, 'auth_error', 'Missing proxy auth context', 'missing_proxy_auth');
    const parsed = await parseVideoCreateInput(request, reply);
    if (!parsed) return;

    const startedAt = Date.now();
    const traceId = await createProxyDebugTrace({
      downstreamPath: '/v1/videos',
      requestedModel: parsed.requestedModel,
      downstreamApiKeyId: auth.keyId,
      requestHeaders: request.headers
    });
    const logId = await createPendingProxyLog({
      debugTraceId: traceId,
      downstreamApiKeyId: auth.keyId,
      modelRequested: parsed.requestedModel,
      isStream: false
    });
    let nextAttemptIndex = 1;
    const excludedChannelIds: number[] = [];
    const maxAttempts = Math.max(1, config.proxyMaxChannelAttempts);
    let retryCount = 0;
    let lastError = 'No available channel';

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const selected = await selectChannel(parsed.requestedModel, auth.policy, excludedChannelIds);
      if (!selected) break;

      const result = await createVideoTaskWithChannel({
        selected,
        createInput: parsed,
        requestHeaders: request.headers,
        downstreamApiKeyId: auth.keyId,
        retryCount,
        traceId,
        logId,
        takeAttemptIndex: () => nextAttemptIndex++,
        startedAt,
        reply
      });
      if (result.done) return result.response;

      lastError = result.error;
      excludedChannelIds.push(selected.channelId);
      retryCount += 1;
    }

    await finalizeProxyDebugTrace(traceId, {
      finalStatus: 'failed',
      finalHttpStatus: 503,
      decisionSummary: { error: lastError, excludedChannelIds, retryCount }
    });
    await finalizeProxyLog({
      id: logId,
      debugTraceId: traceId,
      downstreamApiKeyId: auth.keyId,
      modelRequested: parsed.requestedModel,
      status: 'failed',
      httpStatus: 503,
      isStream: false,
      latencyMs: Date.now() - startedAt,
      errorMessage: lastError,
      retryCount
    });
    return sendError(reply, 503, 'no_available_channel', lastError, 'no_available_channel');
  });

  app.get('/v1/videos/:id', async (request: VideoTaskRequest, reply) => {
    return handleMappedVideoTaskRequest(request, reply, 'GET');
  });

  app.delete('/v1/videos/:id', async (request: VideoTaskRequest, reply) => {
    return handleMappedVideoTaskRequest(request, reply, 'DELETE');
  });
}

async function parseVideoCreateInput(request: FastifyRequest, reply: FastifyReply): Promise<VideoCreateInput | null> {
  const formData = await parseMultipartFormData(request);
  if (formData) {
    const requestedModel = getStringField(formData, 'model');
    if (!requestedModel) {
      sendError(reply, 400, 'validation_error', 'model is required', 'invalid_payload');
      return null;
    }
    if (isTruthyFormValue(formData.get('stream'))) {
      sendError(reply, 400, 'validation_error', 'stream is not supported on /v1/videos', 'stream_not_supported');
      return null;
    }
    return { requestedModel, formData, jsonBody: null };
  }

  const parsed = videoCreateBodySchema.safeParse(request.body);
  if (!parsed.success) {
    sendError(reply, 400, 'validation_error', parsed.error.message, 'invalid_payload');
    return null;
  }
  if (parsed.data.stream) {
    sendError(reply, 400, 'validation_error', 'stream is not supported on /v1/videos', 'stream_not_supported');
    return null;
  }
  return { requestedModel: parsed.data.model, formData: null, jsonBody: parsed.data };
}

async function createVideoTaskWithChannel(input: {
  selected: SelectedChannel;
  createInput: VideoCreateInput;
  requestHeaders: Record<string, string | string[] | undefined>;
  downstreamApiKeyId: number | null;
  retryCount: number;
  traceId: number;
  logId: number;
  takeAttemptIndex: () => number;
  startedAt: number;
  reply: FastifyReply;
}): Promise<{ done: true; response: unknown } | { done: false; error: string }> {
  const targetUrl = resolveOpenAiPath(input.selected.baseUrl, '/v1/videos');
  const controller = config.proxyFirstByteTimeoutSec > 0 ? new AbortController() : null;
  let firstByteTimer: ReturnType<typeof setTimeout> | null = null;
  const attemptIndex = input.takeAttemptIndex();

  try {
    const upstreamRequest = await buildVideoCreateUpstreamRequest(input.createInput, input.selected.sourceModel);
    const headers = buildVideoHeaders({
      requestHeaders: input.requestHeaders,
      customHeaders: input.selected.customHeaders,
      token: input.selected.accountToken,
      contentType: upstreamRequest.contentType
    });
    const dispatcher = fetchDispatcher(input.selected.proxyUrl);
    const fetchOptions: NonNullable<Parameters<typeof fetch>[1]> = {
      method: 'POST',
      headers
    };
    if (upstreamRequest.body !== undefined) fetchOptions.body = upstreamRequest.body;
    if (dispatcher) fetchOptions.dispatcher = dispatcher;
    if (controller) {
      fetchOptions.signal = controller.signal;
      firstByteTimer = setTimeout(() => controller.abort(), config.proxyFirstByteTimeoutSec * 1000);
    }
    await recordProxyDebugAttempt({
      traceId: input.traceId,
      attemptIndex,
      channelId: input.selected.channelId,
      routeId: input.selected.routeId,
      accountId: input.selected.accountId,
      modelActual: input.selected.sourceModel,
      endpoint: formatSelectedEndpointName(input.selected),
      requestPath: '/v1/videos',
      targetUrl,
      requestHeaders: headers
    });
    const response = await fetch(targetUrl, fetchOptions);
    if (firstByteTimer) clearTimeout(firstByteTimer);
    const responseHeaders = headersToRecord(response.headers);

    if (!response.ok) {
      const text = await response.text();
      const error = `Upstream ${response.status}: ${text.slice(0, 500)}`;
      await recordProxyDebugAttempt({
        traceId: input.traceId,
        attemptIndex,
        endpoint: formatSelectedEndpointName(input.selected),
        requestPath: '/v1/videos',
        targetUrl,
        requestHeaders: headers,
        responseStatus: response.status,
        responseHeaders,
        rawErrorText: error
      });
      await recordChannelFailure(input.selected.channelId, error);
      if (isRetryableStatus(response.status)) return { done: false, error };
      await writeVideoCreateFailure(input, response.status, targetUrl, responseHeaders, error);
      return {
        done: true,
        response: sendError(input.reply, upstreamStatusToClientStatus(response.status), 'upstream_error', error, 'upstream_error')
      };
    }

    const text = await response.text();
    const payload = parseJsonPayload(text);
    if (!payload) {
      const error = `Upstream returned non-JSON response: ${text.slice(0, 160)}`;
      await recordProxyDebugAttempt({
        traceId: input.traceId,
        attemptIndex,
        endpoint: formatSelectedEndpointName(input.selected),
        requestPath: '/v1/videos',
        targetUrl,
        requestHeaders: headers,
        responseStatus: response.status,
        responseHeaders,
        rawErrorText: error
      });
      await recordChannelFailure(input.selected.channelId, error);
      await writeVideoCreateFailure(input, 502, targetUrl, responseHeaders, error);
      return { done: true, response: sendError(input.reply, 502, 'upstream_error', error, 'upstream_error') };
    }

    const upstreamVideoId = typeof payload.id === 'string' ? payload.id.trim() : '';
    if (!upstreamVideoId) {
      const error = 'Upstream video response did not include id';
      await recordProxyDebugAttempt({
        traceId: input.traceId,
        attemptIndex,
        endpoint: formatSelectedEndpointName(input.selected),
        requestPath: '/v1/videos',
        targetUrl,
        requestHeaders: headers,
        responseStatus: response.status,
        responseHeaders,
        rawErrorText: error
      });
      await recordChannelFailure(input.selected.channelId, error);
      await writeVideoCreateFailure(input, 502, targetUrl, responseHeaders, error);
      return { done: true, response: sendError(input.reply, 502, 'upstream_error', error, 'upstream_error') };
    }

    const mapping = await saveProxyVideoTask({
      upstreamVideoId,
      upstreamUrl: input.selected.baseUrl,
      tokenRef: buildProxyVideoTaskTokenRef({ accountId: input.selected.accountId, tokenId: input.selected.tokenId }),
      requestedModel: input.selected.requestedModel,
      actualModel: input.selected.sourceModel,
      channelId: input.selected.channelId,
      accountId: input.selected.accountId,
      statusSnapshot: payload,
      upstreamResponseMeta: { contentType: response.headers.get('content-type') || 'application/json' },
      lastUpstreamStatus: response.status
    });

    await recordProxyDebugAttempt({
      traceId: input.traceId,
      attemptIndex,
      endpoint: formatSelectedEndpointName(input.selected),
      requestPath: '/v1/videos',
      targetUrl,
      requestHeaders: headers,
      responseStatus: response.status,
      responseHeaders
    });
    await recordChannelSuccess(input.selected.channelId, Date.now() - input.startedAt, 0);
    if (input.downstreamApiKeyId !== null) await recordManagedKeyCostUsage(input.downstreamApiKeyId, 0);
    await finalizeProxyDebugTrace(input.traceId, {
      selectedChannelId: input.selected.channelId,
      selectedRouteId: input.selected.routeId,
      selectedAccountId: input.selected.accountId,
      decisionSummary: { retryCount: input.retryCount },
      finalStatus: 'success',
      finalHttpStatus: response.status,
      finalUpstreamPath: targetUrl,
      finalResponseHeaders: responseHeaders
    });
    await finalizeProxyLog({
      id: input.logId,
      debugTraceId: input.traceId,
      routeId: input.selected.routeId,
      channelId: input.selected.channelId,
      accountId: input.selected.accountId,
      downstreamApiKeyId: input.downstreamApiKeyId,
      modelRequested: input.selected.requestedModel,
      modelActual: input.selected.sourceModel,
      status: 'success',
      httpStatus: response.status,
      isStream: false,
      latencyMs: Date.now() - input.startedAt,
      retryCount: input.retryCount
    });
    return {
      done: true,
      response: input.reply.code(response.status).send(rewriteVideoResponsePublicId(payload, mapping.publicId))
    };
  } catch (error) {
    if (firstByteTimer) clearTimeout(firstByteTimer);
    const message = error instanceof Error && error.name === 'AbortError' && config.proxyFirstByteTimeoutSec > 0
      ? `First byte timeout after ${config.proxyFirstByteTimeoutSec}s`
      : error instanceof Error
        ? error.message
        : 'Network error';
    await recordProxyDebugAttempt({
      traceId: input.traceId,
      attemptIndex,
      endpoint: formatSelectedEndpointName(input.selected),
      requestPath: '/v1/videos',
      targetUrl,
      requestHeaders: {},
      rawErrorText: message
    });
    await recordChannelFailure(input.selected.channelId, message);
    return { done: false, error: message };
  }
}

async function handleMappedVideoTaskRequest(request: VideoTaskRequest, reply: FastifyReply, method: 'GET' | 'DELETE') {
  const auth = getProxyAuthContext(request);
  if (!auth) return sendError(reply, 401, 'auth_error', 'Missing proxy auth context', 'missing_proxy_auth');
  const mapping = await getProxyVideoTaskByPublicId(request.params.id);
  if (!mapping) {
    return reply.code(404).send({
      error: { message: 'Video task not found', type: 'not_found_error', code: 'video_task_not_found' }
    });
  }

  const startedAt = Date.now();
  const requestedModel = mapping.requestedModel || mapping.actualModel || 'video';
  const traceId = await createProxyDebugTrace({
    downstreamPath: `/v1/videos/${request.params.id}`,
    requestedModel,
    downstreamApiKeyId: auth.keyId,
    requestHeaders: request.headers
  });
  const logId = await createPendingProxyLog({
    debugTraceId: traceId,
    downstreamApiKeyId: auth.keyId,
    modelRequested: requestedModel,
    isStream: false
  });
  let nextAttemptIndex = 1;
  const credential = await resolveProxyVideoTaskCredential(mapping);
  if (!credential) {
    const error = 'Video task credential is unavailable';
    await finalizeMappedVideoTaskFailure(traceId, logId, mapping, auth.keyId, method, 502, startedAt, error);
    return sendError(reply, 502, 'upstream_error', error, 'upstream_error');
  }

  const upstreamResult = await requestMappedVideoTaskUpstream({
    mapping,
    credential,
    method,
    requestHeaders: request.headers,
    traceId,
    takeAttemptIndex: () => nextAttemptIndex++
  });
  if (!upstreamResult.ok) {
    await finalizeMappedVideoTaskFailure(traceId, logId, mapping, auth.keyId, method, upstreamResult.status, startedAt, upstreamResult.message);
    return sendError(reply, upstreamResult.status, 'upstream_error', upstreamResult.message, 'upstream_error');
  }

  const response = upstreamResult.response;
  const text = method === 'DELETE' && response.status === 204 ? '' : await response.text();
  if (!response.ok) {
    await finalizeMappedVideoTaskFailure(traceId, logId, mapping, auth.keyId, method, response.status, startedAt, text || response.statusText, upstreamResult.targetUrl, response.headers);
    return relayUpstreamText(reply, response, text);
  }

  if (method === 'DELETE') {
    await deleteProxyVideoTaskByPublicId(mapping.publicId);
    await finalizeMappedVideoTaskSuccess(traceId, logId, mapping, auth.keyId, method, response.status, startedAt, upstreamResult.targetUrl, response.headers);
    return reply.code(response.status).send();
  }

  const payload = parseJsonPayload(text);
  if (!payload) {
    await finalizeMappedVideoTaskSuccess(traceId, logId, mapping, auth.keyId, method, response.status, startedAt, upstreamResult.targetUrl, response.headers);
    return reply.code(response.status).type(response.headers.get('content-type') || 'text/plain').send(text);
  }

  await refreshProxyVideoTaskSnapshot(mapping.publicId, {
    statusSnapshot: payload,
    upstreamResponseMeta: { contentType: response.headers.get('content-type') || 'application/json' },
    lastUpstreamStatus: response.status
  });
  await finalizeMappedVideoTaskSuccess(traceId, logId, mapping, auth.keyId, method, response.status, startedAt, upstreamResult.targetUrl, response.headers);
  return reply.code(response.status).send(rewriteVideoResponsePublicId(payload, mapping.publicId));
}

async function requestMappedVideoTaskUpstream(input: {
  mapping: ProxyVideoTaskRecord;
  credential: ProxyVideoTaskCredential;
  method: 'GET' | 'DELETE';
  requestHeaders: Record<string, string | string[] | undefined>;
  traceId: number;
  takeAttemptIndex: () => number;
}): Promise<
  | { ok: true; response: Response; targetUrl: string }
  | { ok: false; status: number; message: string }
> {
  const targetUrl = resolveOpenAiPath(input.credential.upstreamUrl, `/v1/videos/${encodeURIComponent(input.mapping.upstreamVideoId)}`);
  const headers = buildVideoHeaders({
    requestHeaders: input.requestHeaders,
    customHeaders: input.credential.customHeaders,
    token: input.credential.token,
    contentType: null
  });
  const attemptIndex = input.takeAttemptIndex();

  try {
    const dispatcher = fetchDispatcher(input.credential.proxyUrl);
    const fetchOptions: NonNullable<Parameters<typeof fetch>[1]> = {
      method: input.method,
      headers
    };
    if (dispatcher) fetchOptions.dispatcher = dispatcher;
    await recordProxyDebugAttempt({
      traceId: input.traceId,
      attemptIndex,
      endpoint: formatMappedEndpointName(input.credential),
      requestPath: `/v1/videos/${input.mapping.upstreamVideoId}`,
      targetUrl,
      requestHeaders: headers
    });
    const response = await fetch(targetUrl, fetchOptions);
    const responseHeaders = headersToRecord(response.headers);

    if (!response.ok) {
      const rawErrorText = await response.clone().text().catch(() => '');
      await recordProxyDebugAttempt({
        traceId: input.traceId,
        attemptIndex,
        endpoint: formatMappedEndpointName(input.credential),
        requestPath: `/v1/videos/${input.mapping.upstreamVideoId}`,
        targetUrl,
        requestHeaders: headers,
        responseStatus: response.status,
        responseHeaders,
        rawErrorText: rawErrorText || `HTTP ${response.status}`
      });
      return { ok: true, response, targetUrl };
    }

    await recordProxyDebugAttempt({
      traceId: input.traceId,
      attemptIndex,
      endpoint: formatMappedEndpointName(input.credential),
      requestPath: `/v1/videos/${input.mapping.upstreamVideoId}`,
      targetUrl,
      requestHeaders: headers,
      responseStatus: response.status,
      responseHeaders
    });
    return { ok: true, response, targetUrl };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Network error';
    await recordProxyDebugAttempt({
      traceId: input.traceId,
      attemptIndex,
      endpoint: formatMappedEndpointName(input.credential),
      requestPath: `/v1/videos/${input.mapping.upstreamVideoId}`,
      targetUrl,
      requestHeaders: headers,
      rawErrorText: message
    });
    return { ok: false, status: 502, message };
  }
}

async function buildVideoCreateUpstreamRequest(input: VideoCreateInput, upstreamModel: string): Promise<{ body: UpstreamRequestBody; contentType: string | null }> {
  if (!input.formData) {
    const body: Record<string, unknown> = { ...(input.jsonBody || {}), model: upstreamModel };
    delete body.stream;
    delete body.stream_options;
    return { body: JSON.stringify(body), contentType: 'application/json' };
  }
  return { body: await cloneVideoFormData(input.formData, upstreamModel), contentType: null };
}

async function cloneVideoFormData(formData: MultipartFormData, upstreamModel: string): Promise<FormData> {
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
  // Video 创建必须使用命中的真实上游模型。
  next.set('model', upstreamModel);
  return next;
}

async function writeVideoCreateFailure(
  input: {
    selected: SelectedChannel;
    downstreamApiKeyId: number | null;
    retryCount: number;
    traceId: number;
    logId: number;
    startedAt: number;
  },
  httpStatus: number,
  targetUrl: string,
  responseHeaders: Record<string, string>,
  errorMessage: string
): Promise<void> {
  await finalizeProxyDebugTrace(input.traceId, {
    selectedChannelId: input.selected.channelId,
    selectedRouteId: input.selected.routeId,
    selectedAccountId: input.selected.accountId,
    finalStatus: 'failed',
    finalHttpStatus: httpStatus,
    finalUpstreamPath: targetUrl,
    finalResponseHeaders: responseHeaders
  });
  await finalizeProxyLog({
    id: input.logId,
    debugTraceId: input.traceId,
    routeId: input.selected.routeId,
    channelId: input.selected.channelId,
    accountId: input.selected.accountId,
    downstreamApiKeyId: input.downstreamApiKeyId,
    modelRequested: input.selected.requestedModel,
    modelActual: input.selected.sourceModel,
    status: 'failed',
    httpStatus,
    isStream: false,
    latencyMs: Date.now() - input.startedAt,
    errorMessage,
    retryCount: input.retryCount
  });
}

async function finalizeMappedVideoTaskSuccess(
  traceId: number,
  logId: number,
  mapping: ProxyVideoTaskRecord,
  downstreamApiKeyId: number | null,
  method: 'GET' | 'DELETE',
  httpStatus: number,
  startedAt: number,
  targetUrl: string,
  responseHeaders: Headers
): Promise<void> {
  if (mapping.channelId !== null) await recordChannelSuccess(mapping.channelId, Date.now() - startedAt, 0);
  await finalizeProxyDebugTrace(traceId, {
    selectedChannelId: mapping.channelId,
    selectedAccountId: mapping.accountId,
    decisionSummary: { method },
    finalStatus: 'success',
    finalHttpStatus: httpStatus,
    finalUpstreamPath: targetUrl,
    finalResponseHeaders: headersToRecord(responseHeaders)
  });
  await finalizeProxyLog({
    id: logId,
    debugTraceId: traceId,
    channelId: mapping.channelId,
    accountId: mapping.accountId,
    downstreamApiKeyId,
    modelRequested: mapping.requestedModel,
    modelActual: mapping.actualModel,
    status: 'success',
    httpStatus,
    isStream: false,
    latencyMs: Date.now() - startedAt
  });
}

async function finalizeMappedVideoTaskFailure(
  traceId: number,
  logId: number,
  mapping: ProxyVideoTaskRecord,
  downstreamApiKeyId: number | null,
  method: 'GET' | 'DELETE',
  httpStatus: number,
  startedAt: number,
  errorMessage: string,
  targetUrl?: string,
  responseHeaders?: Headers
): Promise<void> {
  if (mapping.channelId !== null) await recordChannelFailure(mapping.channelId, errorMessage);
  await finalizeProxyDebugTrace(traceId, {
    selectedChannelId: mapping.channelId,
    selectedAccountId: mapping.accountId,
    decisionSummary: { method, error: errorMessage },
    finalStatus: 'failed',
    finalHttpStatus: httpStatus,
    finalUpstreamPath: targetUrl ?? null,
    finalResponseHeaders: responseHeaders ? headersToRecord(responseHeaders) : null
  });
  await finalizeProxyLog({
    id: logId,
    debugTraceId: traceId,
    channelId: mapping.channelId,
    accountId: mapping.accountId,
    downstreamApiKeyId,
    modelRequested: mapping.requestedModel,
    modelActual: mapping.actualModel,
    status: 'failed',
    httpStatus,
    isStream: false,
    latencyMs: Date.now() - startedAt,
    errorMessage
  });
}

function rewriteVideoResponsePublicId(payload: Record<string, unknown>, publicId: string): Record<string, unknown> {
  return { ...payload, id: publicId };
}

function parseJsonPayload(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function relayUpstreamText(reply: FastifyReply, response: Response, text: string) {
  const contentType = response.headers.get('content-type') || 'text/plain';
  const payload = contentType.includes('application/json') ? parseJsonPayload(text) : null;
  if (payload) return reply.code(response.status).send(payload);
  return reply.code(response.status).type(contentType).send(text);
}

function buildVideoHeaders(input: {
  requestHeaders: Record<string, string | string[] | undefined>;
  customHeaders: Record<string, string> | null;
  token: string;
  contentType: string | null;
}): Record<string, string> {
  const headers = mergeCustomHeaders(safeHeaders(input.requestHeaders), input.customHeaders);
  setHeader(headers, 'Authorization', `Bearer ${input.token}`);
  if (input.contentType === null) {
    deleteHeader(headers, 'Content-Type');
  } else {
    setHeader(headers, 'Content-Type', input.contentType);
  }
  setHeader(headers, 'Accept', 'application/json');
  return headers;
}

function formatSelectedEndpointName(selected: SelectedChannel): string {
  return selected.accountName ? `${selected.accountName}#${selected.accountId}` : `account#${selected.accountId}`;
}

function formatMappedEndpointName(credential: ProxyVideoTaskCredential): string {
  return credential.accountName || credential.upstreamUrl;
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

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function upstreamStatusToClientStatus(status: number): number {
  if (status === 401 || status === 403) return 502;
  if (status === 404) return 502;
  return status >= 500 ? 502 : status;
}

function headersToRecord(headers: Headers): Record<string, string> {
  const output: Record<string, string> = {};
  headers.forEach((value, key) => {
    output[key] = value;
  });
  return output;
}

function setHeader(headers: Record<string, string>, name: string, value: string): void {
  const normalized = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === normalized) delete headers[key];
  }
  headers[name] = value;
}

function deleteHeader(headers: Record<string, string>, name: string): void {
  const normalized = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === normalized) delete headers[key];
  }
}
