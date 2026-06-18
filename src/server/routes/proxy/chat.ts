import type { FastifyInstance, FastifyReply } from 'fastify';
import { fetch, type Headers, type Response } from 'undici';
import { z } from 'zod';
import { config, type TemporaryDisableRule } from '../../config.js';
import { getProxyAuthContext } from '../../middleware/auth.js';
import { recordManagedKeyCostUsage } from '../../services/downstreamKeyService.js';
import {
  createProxyDebugTrace,
  finalizeProxyDebugTrace,
  recordProxyDebugAttempt,
  type RecordProxyDebugAttemptInput
} from '../../services/proxyDebugTraceService.js';
import { createPendingProxyLog, finalizeProxyLog } from '../../services/proxyLogService.js';
import { recordChannelFailure, recordChannelSuccess, selectChannel, type SelectedChannel } from '../../services/tokenRouter.js';
import type { DownstreamRoutingPolicy } from '../../services/downstreamPolicy.js';
import { fetchDispatcher, mergeCustomHeaders, resolveOpenAiPath, safeHeaders } from '../../shared/http.js';
import { sendError } from '../../shared/errors.js';

export const openAiProxyBodySchema = z.object({
  model: z.string().trim().min(1),
  stream: z.boolean().optional()
}).passthrough();

export const chatBodySchema = openAiProxyBodySchema.extend({
  messages: z.array(z.unknown()).min(1)
});

export type OpenAiProxyBody = z.infer<typeof openAiProxyBodySchema>;
export type ChatBody = z.infer<typeof chatBodySchema>;
type UpstreamRequestBody = NonNullable<Parameters<typeof fetch>[1]>['body'];
type UsageSummary = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};
type TemporaryDisableMatch = {
  rule: TemporaryDisableRule;
  ruleIndex: number;
  matchedKeyword: string;
};
type RetryableProxyFailure = { done: false; error: string; switchChannel?: boolean };
type ProxyAttemptResult = { done: true; response: unknown } | RetryableProxyFailure;

export type OpenAiProxyEndpointOptions = {
  downstreamPath: string;
  upstreamPath: string;
  headerMode?: 'openai' | 'anthropic';
  extraAnthropicBetas?: string[];
  transformBody?: (body: Record<string, unknown>) => Record<string, unknown>;
  buildUpstreamRequest?: (
    body: Record<string, unknown>,
    selected: SelectedChannel
  ) => Promise<{ body: UpstreamRequestBody; contentType?: string | null }> | { body: UpstreamRequestBody; contentType?: string | null };
  transformPayload?: (payload: Record<string, unknown>) => Record<string, unknown>;
  streamContentType?: string;
  transformStream?: (
    body: AsyncIterable<Uint8Array>,
    context: { requestedModel: string; upstreamModel: string }
  ) => AsyncIterable<Uint8Array>;
};

export type ProxyRuntimeOptions = {
  forcedChannelId?: number | null;
  includeDebugTraceId?: boolean;
};

const chatProxyOptions: OpenAiProxyEndpointOptions = {
  downstreamPath: '/v1/chat/completions',
  upstreamPath: '/v1/chat/completions'
};

export async function chatProxyRoutes(app: FastifyInstance): Promise<void> {
  app.post('/v1/chat/completions', async (request, reply) => {
    const auth = getProxyAuthContext(request);
    if (!auth) return sendError(reply, 401, 'auth_error', 'Missing proxy auth context', 'missing_proxy_auth');
    const parsed = chatBodySchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'validation_error', parsed.error.message, 'invalid_payload');
    return proxyOpenAiEndpoint(parsed.data, auth.keyId, auth.policy, request.headers, reply, chatProxyOptions);
  });

  app.post('/chat/completions', async (request, reply) => {
    const auth = getProxyAuthContext(request);
    if (!auth) return sendError(reply, 401, 'auth_error', 'Missing proxy auth context', 'missing_proxy_auth');
    const parsed = chatBodySchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'validation_error', parsed.error.message, 'invalid_payload');
    return proxyOpenAiEndpoint(parsed.data, auth.keyId, auth.policy, request.headers, reply, chatProxyOptions);
  });
}

export async function proxyChat(
  body: ChatBody,
  downstreamApiKeyId: number | null,
  policy: DownstreamRoutingPolicy,
  requestHeaders: Record<string, string | string[] | undefined>,
  reply: FastifyReply,
  runtimeOptions: ProxyRuntimeOptions = {}
) {
  return proxyOpenAiEndpoint(body, downstreamApiKeyId, policy, requestHeaders, reply, chatProxyOptions, runtimeOptions);
}

export async function proxyOpenAiEndpoint(
  body: OpenAiProxyBody,
  downstreamApiKeyId: number | null,
  policy: DownstreamRoutingPolicy,
  requestHeaders: Record<string, string | string[] | undefined>,
  reply: FastifyReply,
  options: OpenAiProxyEndpointOptions,
  runtimeOptions: ProxyRuntimeOptions = {}
) {
  const excludedChannelIds: number[] = [];
  const maxChannelAttempts = Math.max(1, config.proxyMaxChannelAttempts);
  const channelRetryAttempts = Math.max(1, config.proxyChannelRetryAttempts);
  const startedAt = Date.now();
  let nextAttemptIndex = 1;
  const traceId = await createProxyDebugTrace({
    downstreamPath: options.downstreamPath,
    requestedModel: body.model,
    downstreamApiKeyId,
    requestHeaders
  });
  const logId = await createPendingProxyLog({
    debugTraceId: traceId,
    downstreamApiKeyId,
    modelRequested: body.model,
    isStream: body.stream ?? false
  });
  let retryCount = 0;
  let lastError = 'No available channel';
  let attemptedAnyChannel = false;

  while (excludedChannelIds.length < maxChannelAttempts) {
    const selected = await selectChannel(body.model, policy, excludedChannelIds, {
      forcedChannelId: runtimeOptions.forcedChannelId ?? null
    });
    if (!selected) {
      break;
    }
    attemptedAnyChannel = true;
    let channelFailures = 0;

    while (channelFailures < channelRetryAttempts) {
      const result = await callUpstreamChat({
        selected,
        body,
        requestHeaders,
        downstreamApiKeyId,
        retryCount,
        traceId,
        logId,
        takeAttemptIndex: () => nextAttemptIndex++,
        startedAt,
        reply,
        options,
        runtimeOptions
      });

      if (result.done) return result.response;

      lastError = result.error;
      channelFailures += 1;
      retryCount += 1;
      if (result.switchChannel) break;
    }
    excludedChannelIds.push(selected.channelId);
  }

  const finalError = buildChannelExhaustedError({
    attemptedAnyChannel,
    attemptedChannelCount: excludedChannelIds.length,
    maxChannelAttempts,
    lastError
  });
  await finalizeProxyDebugTrace(traceId, {
    finalStatus: 'failed',
    finalHttpStatus: 503,
    decisionSummary: { error: finalError, excludedChannelIds, retryCount }
  });
  await finalizeProxyLog({
    id: logId,
    debugTraceId: traceId,
    downstreamApiKeyId,
    modelRequested: body.model,
    status: 'failed',
    httpStatus: 503,
    isStream: body.stream ?? false,
    latencyMs: Date.now() - startedAt,
    errorMessage: finalError,
    retryCount
  });
  return sendError(reply, 503, 'no_available_channel', finalError, 'no_available_channel');
}

async function callUpstreamChat(input: {
  selected: SelectedChannel;
  body: OpenAiProxyBody;
  requestHeaders: Record<string, string | string[] | undefined>;
  downstreamApiKeyId: number | null;
  retryCount: number;
  traceId: number;
  logId: number;
  takeAttemptIndex: () => number;
  startedAt: number;
  reply: FastifyReply;
  options: OpenAiProxyEndpointOptions;
  runtimeOptions: ProxyRuntimeOptions;
}): Promise<ProxyAttemptResult> {
  const baseUpstreamBody: Record<string, unknown> = {
    ...input.body,
    model: input.selected.sourceModel
  };
  const upstreamBody = input.options.transformBody ? input.options.transformBody(baseUpstreamBody) : baseUpstreamBody;
  const upstreamRequest = input.options.buildUpstreamRequest
    ? await input.options.buildUpstreamRequest(upstreamBody, input.selected)
    : { body: JSON.stringify(upstreamBody), contentType: 'application/json' };
  const contentType = Object.prototype.hasOwnProperty.call(upstreamRequest, 'contentType')
    ? upstreamRequest.contentType ?? null
    : 'application/json';
  const baseHeaders = mergeCustomHeaders(safeHeaders(input.requestHeaders), input.selected.customHeaders);
  const headers = buildUpstreamHeaders({
    baseHeaders,
    token: input.selected.accountToken,
    stream: input.body.stream ?? false,
    options: input.options,
    contentType
  });
  const url = resolveOpenAiPath(input.selected.baseUrl, input.options.upstreamPath);
  const controller = config.proxyFirstByteTimeoutSec > 0 ? new AbortController() : null;
  let firstByteTimer: ReturnType<typeof setTimeout> | null = null;
  const attemptRecord = buildAttemptRecordInput(
    { ...input, attemptIndex: input.takeAttemptIndex() },
    url,
    headers
  );

  try {
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
    await recordProxyDebugAttempt(attemptRecord);
    const response = await fetch(url, fetchOptions);
    if (firstByteTimer) clearTimeout(firstByteTimer);

    if (!response.ok) {
      const text = await response.text();
      const error = `Upstream ${response.status}: ${text.slice(0, 500)}`;
      // 配额、限流等业务错误命中规则后，临时冷却当前通道并交给外层继续尝试下一通道。
      const temporaryDisableMatch = matchTemporaryDisableRule(response.status, text);
      const temporaryDisableUntil = temporaryDisableMatch
        ? new Date(Date.now() + temporaryDisableMatch.rule.durationMinutes * 60_000).toISOString()
        : null;
      const temporaryDisableReason = temporaryDisableMatch && temporaryDisableUntil
        ? buildTemporaryDisableReason(error, temporaryDisableMatch, temporaryDisableUntil)
        : null;
      await recordProxyDebugAttempt({
        ...attemptRecord,
        responseStatus: response.status,
        responseHeaders: headersToRecord(response.headers),
        rawErrorText: temporaryDisableReason ?? error
      });
      if (temporaryDisableMatch && temporaryDisableUntil && temporaryDisableReason) {
        await recordChannelFailure(input.selected.channelId, temporaryDisableReason, {
          cooldownUntil: temporaryDisableUntil,
          eventTitle: '上游通道临时禁用',
          eventLevel: 'warning'
        });
        return { done: false, error: temporaryDisableReason, switchChannel: true };
      }
      await recordChannelFailure(input.selected.channelId, error);
      if (isRetryableUpstreamStatus(response.status)) {
        return { done: false, error };
      }
      await finalizeProxyDebugTrace(input.traceId, {
        selectedChannelId: input.selected.channelId,
        selectedRouteId: input.selected.routeId,
        selectedAccountId: input.selected.accountId,
        decisionSummary: { error, retryCount: input.retryCount },
        finalStatus: 'failed',
        finalHttpStatus: response.status,
        finalUpstreamPath: url,
        finalResponseHeaders: headersToRecord(response.headers)
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
        httpStatus: response.status,
        isStream: input.body.stream ?? false,
        latencyMs: Date.now() - input.startedAt,
        errorMessage: error,
        retryCount: input.retryCount
      });
      return {
        done: true,
        response: sendError(input.reply, upstreamStatusToClientStatus(response.status), 'upstream_error', error, 'upstream_error')
      };
    }

    if (input.body.stream) {
      await streamUpstreamResponse(input.reply, response, {
        ...input,
        targetUrl: url,
        attemptRecord
      });
      return { done: true, response: input.reply };
    }

    const upstreamPayload = await response.json() as Record<string, unknown>;
    const usage = extractUsage(upstreamPayload);
    const payload = input.options.transformPayload ? input.options.transformPayload(upstreamPayload) : upstreamPayload;
    await recordProxyDebugAttempt({
      ...attemptRecord,
      responseStatus: response.status,
      responseHeaders: headersToRecord(response.headers)
    });
    const estimatedCost = estimateUsageCost(usage.totalTokens, input.selected.accountUnitCost);
    await recordChannelSuccess(input.selected.channelId, Date.now() - input.startedAt, estimatedCost);
    if (input.downstreamApiKeyId !== null) {
      await recordManagedKeyCostUsage(input.downstreamApiKeyId, estimatedCost);
    }
    await finalizeProxyDebugTrace(input.traceId, {
      selectedChannelId: input.selected.channelId,
      selectedRouteId: input.selected.routeId,
      selectedAccountId: input.selected.accountId,
      decisionSummary: { usage, retryCount: input.retryCount },
      finalStatus: 'success',
      finalHttpStatus: response.status,
      finalUpstreamPath: url,
      finalResponseHeaders: headersToRecord(response.headers)
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
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
      estimatedCost,
      retryCount: input.retryCount
    });
    if (input.runtimeOptions.includeDebugTraceId) payload.a2apiDebugTraceId = input.traceId;
    return { done: true, response: input.reply.code(response.status).send(payload) };
  } catch (error) {
    if (firstByteTimer) clearTimeout(firstByteTimer);
    const timeoutMessage = config.proxyFirstByteTimeoutSec > 0
      ? `First byte timeout after ${config.proxyFirstByteTimeoutSec}s`
      : null;
    const message = error instanceof Error && error.name === 'AbortError' && timeoutMessage
      ? timeoutMessage
      : error instanceof Error
        ? error.message
        : 'Network error';
      await recordProxyDebugAttempt({
        ...attemptRecord,
        rawErrorText: message
      });
    await recordChannelFailure(input.selected.channelId, message);
    return { done: false, error: message };
  }
}

async function streamUpstreamResponse(
  reply: FastifyReply,
  response: Response,
  input: {
    selected: SelectedChannel;
    downstreamApiKeyId: number | null;
    retryCount: number;
    traceId: number;
    logId: number;
    startedAt: number;
    targetUrl: string;
    attemptRecord: RecordProxyDebugAttemptInput;
    options: OpenAiProxyEndpointOptions;
  }
): Promise<void> {
  const firstByteAt = Date.now();
  reply.hijack();
  reply.raw.writeHead(response.status, {
    'content-type': input.options.streamContentType || response.headers.get('content-type') || 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive'
  });

  try {
    const body = response.body as unknown as AsyncIterable<Uint8Array> | null;
    if (!body) throw new Error('Upstream stream body is empty');
    const streamUsageCollector = createStreamUsageCollector();
    const outputBody = input.options.transformStream
      ? input.options.transformStream(body, {
          requestedModel: input.selected.requestedModel,
          upstreamModel: input.selected.sourceModel
        })
      : body;
    for await (const chunk of outputBody) {
      streamUsageCollector.collect(chunk);
      reply.raw.write(chunk);
    }
    reply.raw.end();
    const streamUsage = streamUsageCollector.finish();
    const estimatedCost = estimateUsageCost(streamUsage.totalTokens, input.selected.accountUnitCost);
    await recordProxyDebugAttempt({
      ...input.attemptRecord,
      responseStatus: response.status,
      responseHeaders: headersToRecord(response.headers)
    });
    await recordChannelSuccess(input.selected.channelId, Date.now() - input.startedAt, estimatedCost);
    if (input.downstreamApiKeyId !== null) {
      await recordManagedKeyCostUsage(input.downstreamApiKeyId, estimatedCost);
    }
    await finalizeProxyDebugTrace(input.traceId, {
      selectedChannelId: input.selected.channelId,
      selectedRouteId: input.selected.routeId,
      selectedAccountId: input.selected.accountId,
      decisionSummary: { usage: streamUsage, retryCount: input.retryCount },
      finalStatus: 'success',
      finalHttpStatus: response.status,
      finalUpstreamPath: input.targetUrl,
      finalResponseHeaders: headersToRecord(response.headers)
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
      isStream: true,
      firstByteLatencyMs: firstByteAt - input.startedAt,
      latencyMs: Date.now() - input.startedAt,
      promptTokens: streamUsage.promptTokens,
      completionTokens: streamUsage.completionTokens,
      totalTokens: streamUsage.totalTokens,
      estimatedCost,
      retryCount: input.retryCount
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Stream failed';
    const finalMessage = formatStreamStartedFailure(message);
    reply.raw.destroy();
    await recordChannelFailure(input.selected.channelId, message);
    await recordProxyDebugAttempt({
      ...input.attemptRecord,
      responseStatus: response.status,
      responseHeaders: headersToRecord(response.headers),
      rawErrorText: finalMessage
    });
    await finalizeProxyDebugTrace(input.traceId, {
      selectedChannelId: input.selected.channelId,
      selectedRouteId: input.selected.routeId,
      selectedAccountId: input.selected.accountId,
      decisionSummary: { error: finalMessage, retryCount: input.retryCount, streamStarted: true },
      finalStatus: 'failed',
      finalHttpStatus: response.status,
      finalUpstreamPath: input.targetUrl,
      finalResponseHeaders: headersToRecord(response.headers)
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
      httpStatus: response.status,
      isStream: true,
      firstByteLatencyMs: firstByteAt - input.startedAt,
      latencyMs: Date.now() - input.startedAt,
      errorMessage: finalMessage,
      retryCount: input.retryCount
    });
  }
}

function buildAttemptRecordInput(
  input: {
    selected: SelectedChannel;
    traceId: number;
    attemptIndex: number;
    options: OpenAiProxyEndpointOptions;
  },
  targetUrl: string,
  requestHeaders: Record<string, string>
): RecordProxyDebugAttemptInput {
  return {
    traceId: input.traceId,
    attemptIndex: input.attemptIndex,
    channelId: input.selected.channelId,
    routeId: input.selected.routeId,
    accountId: input.selected.accountId,
    modelActual: input.selected.sourceModel,
    selectionRandom: input.selected.selectionRandom,
    selectionProbability: input.selected.selectionProbability,
    selectionCandidates: input.selected.selectionCandidates,
    endpoint: formatAccountEndpointName(input.selected),
    requestPath: input.options.upstreamPath,
    targetUrl,
    requestHeaders
  };
}

function formatAccountEndpointName(selected: SelectedChannel): string {
  return selected.accountName ? `${selected.accountName}#${selected.accountId}` : `account#${selected.accountId}`;
}

function isRetryableUpstreamStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function matchTemporaryDisableRule(status: number, rawText: string): TemporaryDisableMatch | null {
  if (!config.temporaryDisableEnabled) return null;
  const text = rawText.toLowerCase();
  for (let index = 0; index < config.temporaryDisableRules.length; index += 1) {
    const rule = config.temporaryDisableRules[index]!;
    if (rule.statusCode !== status) continue;
    const matchedKeyword = rule.keywords.find((keyword) => text.includes(keyword.toLowerCase()));
    if (matchedKeyword) return { rule, ruleIndex: index, matchedKeyword };
  }
  return null;
}

function buildTemporaryDisableReason(error: string, match: TemporaryDisableMatch, cooldownUntil: string): string {
  const description = match.rule.description ? `，${match.rule.description}` : '';
  return `${error}；命中临时禁用规则 #${match.ruleIndex + 1}：HTTP ${match.rule.statusCode} / ${match.matchedKeyword}${description}，冷却至 ${cooldownUntil}`;
}

function buildChannelExhaustedError(input: {
  attemptedAnyChannel: boolean;
  attemptedChannelCount: number;
  maxChannelAttempts: number;
  lastError: string;
}): string {
  if (!input.attemptedAnyChannel) return 'No available channel';
  if (input.attemptedChannelCount >= input.maxChannelAttempts) {
    return `Reached max channel attempts (${input.maxChannelAttempts}): ${input.lastError}`;
  }
  return `No available channel after retryable channel failures: ${input.lastError}`;
}

function formatStreamStartedFailure(message: string): string {
  return `已开始输出流后失败: ${message}`;
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

function buildUpstreamHeaders(input: {
  baseHeaders: Record<string, string>;
  token: string;
  stream: boolean;
  options: OpenAiProxyEndpointOptions;
  contentType: string | null;
}): Record<string, string> {
  if (input.options.headerMode === 'anthropic') {
    return buildAnthropicHeaders(input);
  }
  const headers = { ...input.baseHeaders };
  setHeader(headers, 'Authorization', `Bearer ${input.token}`);
  if (input.contentType === null) {
    deleteHeader(headers, 'Content-Type');
  } else {
    setHeader(headers, 'Content-Type', input.contentType);
  }
  setHeader(headers, 'Accept', input.stream ? 'text/event-stream' : 'application/json');
  return headers;
}

function buildAnthropicHeaders(input: {
  baseHeaders: Record<string, string>;
  token: string;
  stream: boolean;
  options: OpenAiProxyEndpointOptions;
  contentType: string | null;
}): Record<string, string> {
  const headers = { ...input.baseHeaders };
  const version = getHeader(headers, 'anthropic-version') || '2023-06-01';
  const beta = mergeCommaHeader(getHeader(headers, 'anthropic-beta'), input.options.extraAnthropicBetas || []);
  // Anthropic 原生接口使用 x-api-key，并要求 anthropic-version。
  setHeader(headers, 'x-api-key', input.token);
  setHeader(headers, 'anthropic-version', version);
  if (beta) setHeader(headers, 'anthropic-beta', beta);
  if (input.contentType === null) {
    deleteHeader(headers, 'Content-Type');
  } else {
    setHeader(headers, 'Content-Type', input.contentType);
  }
  setHeader(headers, 'Accept', input.stream ? 'text/event-stream' : 'application/json');
  return headers;
}

function getHeader(headers: Record<string, string>, name: string): string {
  const normalized = name.toLowerCase();
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === normalized);
  return entry?.[1]?.trim() || '';
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

function mergeCommaHeader(current: string, additions: string[]): string {
  const values = [
    ...current.split(','),
    ...additions
  ].map((item) => item.trim()).filter(Boolean);
  return Array.from(new Set(values)).join(',');
}

function extractUsageNumber(payload: Record<string, unknown>, key: string): number {
  const usage = payload.usage;
  const usageMetadata = payload.usageMetadata || payload.usage_metadata;
  const value = usage && typeof usage === 'object' && (usage as Record<string, unknown>)[key] !== undefined
    ? (usage as Record<string, unknown>)[key]
    : usageMetadata && typeof usageMetadata === 'object' && (usageMetadata as Record<string, unknown>)[key] !== undefined
      ? (usageMetadata as Record<string, unknown>)[key]
      : payload[key];
  const numberValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numberValue) ? Math.max(0, Math.round(numberValue)) : 0;
}

function emptyUsage(): UsageSummary {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
}

function mergeUsage(current: UsageSummary, next: UsageSummary): UsageSummary {
  const promptTokens = Math.max(current.promptTokens, next.promptTokens);
  const completionTokens = Math.max(current.completionTokens, next.completionTokens);
  return {
    promptTokens,
    completionTokens,
    totalTokens: Math.max(current.totalTokens, next.totalTokens, promptTokens + completionTokens)
  };
}

function extractUsage(payload: Record<string, unknown>): UsageSummary {
  const promptTokens = extractUsageNumber(payload, 'prompt_tokens')
    || extractUsageNumber(payload, 'input_tokens')
    || extractUsageNumber(payload, 'promptTokenCount')
    || extractUsageNumber(payload, 'prompt_token_count');
  const completionTokens = extractUsageNumber(payload, 'completion_tokens')
    || extractUsageNumber(payload, 'output_tokens')
    || extractUsageNumber(payload, 'candidatesTokenCount')
    || extractUsageNumber(payload, 'candidates_token_count');
  const explicitTotalTokens = extractUsageNumber(payload, 'total_tokens')
    || extractUsageNumber(payload, 'totalTokenCount')
    || extractUsageNumber(payload, 'total_token_count');
  return {
    promptTokens,
    completionTokens,
    totalTokens: explicitTotalTokens || promptTokens + completionTokens
  };
}

function extractUsageFromSsePayload(payload: Record<string, unknown>): UsageSummary {
  // 兼容 Responses、Chat、Anthropic、Gemini 常见 usage 位置。
  const responsePayload = payload.response;
  if (responsePayload && typeof responsePayload === 'object') {
    const usage = extractUsage(responsePayload as Record<string, unknown>);
    if (usage.totalTokens > 0) return usage;
  }

  const messagePayload = payload.message;
  if (messagePayload && typeof messagePayload === 'object') {
    const usage = extractUsage(messagePayload as Record<string, unknown>);
    if (usage.totalTokens > 0) return usage;
  }

  const usage = extractUsage(payload);
  if (usage.totalTokens > 0) return usage;

  const usageMetadata = payload.usageMetadata || payload.usage_metadata;
  if (usageMetadata && typeof usageMetadata === 'object') {
    return extractUsage(usageMetadata as Record<string, unknown>);
  }

  return usage;
}

function createStreamUsageCollector(): { collect: (chunk: Uint8Array) => void; finish: () => UsageSummary } {
  const decoder = new TextDecoder();
  let usage = emptyUsage();
  let buffer = '';

  return {
    collect(chunk: Uint8Array) {
      buffer += decoder.decode(chunk, { stream: true });
      const pulled = pullSseDataEvents(buffer);
      buffer = pulled.rest;
      for (const data of pulled.events) {
        usage = mergeUsage(usage, parseSseUsageData(data));
      }
    },
    finish() {
      buffer += decoder.decode();
      const pulled = pullSseDataEvents(`${buffer}\n\n`);
      for (const data of pulled.events) {
        usage = mergeUsage(usage, parseSseUsageData(data));
      }
      return usage;
    }
  };
}

function pullSseDataEvents(buffer: string): { events: string[]; rest: string } {
  let rest = buffer.replace(/\r\n/g, '\n');
  const events: string[] = [];

  while (true) {
    const boundary = rest.indexOf('\n\n');
    if (boundary < 0) break;
    const block = rest.slice(0, boundary);
    rest = rest.slice(boundary + 2);

    const dataLines = block
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart());
    if (dataLines.length === 0) continue;

    const data = dataLines.join('\n').trim();
    if (!data || data === '[DONE]') continue;
    events.push(data);
  }

  return { events, rest };
}

function parseSseUsageData(data: string): UsageSummary {
  try {
    const payload = JSON.parse(data) as unknown;
    if (payload && typeof payload === 'object') {
      return extractUsageFromSsePayload(payload as Record<string, unknown>);
    }
  } catch {
    // 非 JSON SSE 数据只影响统计，不影响原始流透传。
  }
  return emptyUsage();
}

function estimateUsageCost(totalTokens: number, unitCost: number | null): number {
  if (!Number.isFinite(totalTokens) || totalTokens <= 0) return 0;
  if (unitCost === null || !Number.isFinite(unitCost) || unitCost <= 0) return 0;
  return Math.round((totalTokens / 1_000_000) * unitCost * 1_000_000) / 1_000_000;
}
