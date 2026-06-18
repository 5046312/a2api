import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { config } from '../config.js';
import { db, schema } from '../db/index.js';
import { parseJsonObject } from '../shared/json.js';
import { nowIso } from '../shared/time.js';
import { resolveDefaultAccountCredential } from './accountTokenService.js';
import { GLOBAL_ROUTING_POLICY, isCredentialAllowed, isModelAllowedByPolicy, type DownstreamRoutingPolicy } from './downstreamPolicy.js';

export type SelectedChannel = {
  routeId: number;
  channelId: number;
  accountId: number;
  tokenId: number | null;
  accountName: string | null;
  baseUrl: string;
  platform: string;
  customHeaders: Record<string, string> | null;
  proxyUrl: string | null;
  accountToken: string;
  accountUnitCost: number | null;
  sourceModel: string;
  requestedModel: string;
};

export type RouteDecisionCandidate = {
  channelId: number;
  accountId: number;
  accountName: string | null;
  baseUrl: string;
  platform: string;
  priority: number;
  weight: number;
  score: number;
  probability: number;
  available: boolean;
  reasons: string[];
  cooldownUntil: string | null;
};

export type RouteDecision = {
  requestedModel: string;
  actualModel: string;
  matched: boolean;
  routeId: number;
  modelPattern: string | null;
  displayName: string | null;
  routingStrategy: string | null;
  selectedChannelId: number | null;
  selectedAccountId: number | null;
  priority: number | null;
  summary: string[];
  candidates: RouteDecisionCandidate[];
  filtered: Array<{ channelId: number; reason: string }>;
};

export type RouteSelectionOptions = {
  forcedChannelId?: number | null;
};

type ChannelFailureOptions = {
  cooldownUntil?: string;
  eventTitle?: string;
  eventLevel?: 'info' | 'warning' | 'error';
};

type CandidateRow = {
  routeId: number;
  modelPattern: string;
  displayName: string | null;
  routeMode: string;
  routingStrategy: string;
  channelId: number;
  accountId: number;
  tokenId: number | null;
  sourceModel: string | null;
  priority: number;
  weight: number;
  failCount: number;
  consecutiveFailCount: number;
  cooldownUntil: string | null;
  accountStatus: string;
  accountName: string | null;
  accountApiToken: string | null;
  accountUnitCost: number | null;
  accountBaseUrl: string;
  accountPlatform: string;
  accountProxyUrl: string | null;
  accountCustomHeaders: string | null;
  tokenValue: string | null;
  tokenName: string | null;
  tokenEnabled: boolean | null;
  tokenStatus: string | null;
};

let candidateRowsCache: { expiresAt: number; rows: CandidateRow[] } | null = null;

export function clearTokenRouterCache(): void {
  candidateRowsCache = null;
}

export async function getAvailableModels(policy: DownstreamRoutingPolicy) {
  const rows = await loadCandidateRows();
  const models = new Map<string, { routeId: number; contextLength: number | null }>();
  for (const row of rows) {
    if (!isCandidateUsable(row)) continue;
    const modelName = row.displayName || row.modelPattern;
    if (!isModelAllowedByPolicy(modelName, row.routeId, policy)) continue;
    if (!isCredentialAllowed(policy, { accountId: row.accountId, tokenId: row.tokenId })) continue;
    if (!models.has(modelName)) {
      models.set(modelName, { routeId: row.routeId, contextLength: null });
    }
  }
  return [...models.entries()].map(([id, meta]) => ({
    id,
    object: 'model',
    created: 0,
    owned_by: 'a2api',
    context_length: meta.contextLength
  }));
}

export async function selectChannel(
  requestedModel: string,
  policy: DownstreamRoutingPolicy,
  excludedChannelIds: number[] = [],
  options: RouteSelectionOptions = {}
): Promise<SelectedChannel | null> {
  const forcedChannelId = options.forcedChannelId ?? null;
  const rows = await loadCandidateRows();
  const candidates = rows
    .filter((row) => !excludedChannelIds.includes(row.channelId))
    .filter((row) => forcedChannelId === null || row.channelId === forcedChannelId)
    .filter((row) => routeMatches(row, requestedModel))
    .filter(isCandidateUsable)
    .filter((row) => isModelAllowedByPolicy(requestedModel, row.routeId, policy))
    .filter((row) => isCredentialAllowed(policy, { accountId: row.accountId, tokenId: row.tokenId }));

  if (candidates.length === 0) return null;

  candidates.sort((left, right) => {
    if (left.priority !== right.priority) return left.priority - right.priority;
    return scoreCandidate(right) - scoreCandidate(left);
  });

  const bucketPriority = candidates[0]?.priority ?? 0;
  const bucket = candidates.filter((item) => item.priority === bucketPriority);
  const selected = selectWeighted(bucket);
  if (!selected) return null;

  await db
    .update(schema.routeChannels)
    .set({ lastSelectedAt: nowIso() })
    .where(eq(schema.routeChannels.id, selected.channelId))
    .run();

  const accountToken = selected.tokenValue || selected.accountApiToken || '';
  if (!accountToken) return null;

  return {
    routeId: selected.routeId,
    channelId: selected.channelId,
    accountId: selected.accountId,
    tokenId: selected.tokenId,
    accountName: selected.accountName,
    baseUrl: selected.accountBaseUrl,
    platform: selected.accountPlatform,
    customHeaders: parseJsonObject(selected.accountCustomHeaders) as Record<string, string> | null,
    proxyUrl: selected.accountProxyUrl,
    accountToken,
    accountUnitCost: selected.accountUnitCost,
    sourceModel: selected.sourceModel || requestedModel,
    requestedModel
  };
}

export async function explainRouteDecision(
  routeId: number,
  requestedModel: string,
  policy: DownstreamRoutingPolicy = GLOBAL_ROUTING_POLICY,
  excludedChannelIds: number[] = [],
  options: RouteSelectionOptions = {}
): Promise<RouteDecision> {
  const rows = (await loadCandidateRows()).filter((row) => row.routeId === routeId);
  if (rows.length === 0) {
    return {
      requestedModel,
      actualModel: requestedModel,
      matched: false,
      routeId,
      modelPattern: null,
      displayName: null,
      routingStrategy: null,
      selectedChannelId: null,
      selectedAccountId: null,
      priority: null,
      summary: ['未找到启用模型或启用通道'],
      candidates: [],
      filtered: []
    };
  }

  const route = rows[0]!;
  const candidates = rows.map((row) => buildDecisionCandidate(row, requestedModel, policy, excludedChannelIds, options));
  const availableRows = rows.filter((row) => candidates.some((candidate) => candidate.channelId === row.channelId && candidate.available));
  const filtered = candidates
    .filter((candidate) => !candidate.available)
    .map((candidate) => ({ channelId: candidate.channelId, reason: candidate.reasons.join('、') }));

  if (availableRows.length === 0) {
    return {
      requestedModel,
      actualModel: requestedModel,
      matched: true,
      routeId,
      modelPattern: route.modelPattern,
      displayName: route.displayName,
      routingStrategy: route.routingStrategy,
      selectedChannelId: null,
      selectedAccountId: null,
      priority: null,
      summary: options.forcedChannelId
        ? [`命中模型，但指定通道 #${options.forcedChannelId} 不可用`]
        : ['命中模型，但没有可用通道'],
      candidates,
      filtered
    };
  }

  const priority = Math.min(...availableRows.map((row) => row.priority));
  const bucketRows = availableRows.filter((row) => row.priority === priority);
  const selected = route.routingStrategy === 'stable_first'
    ? [...bucketRows].sort((left, right) => scoreCandidate(right) - scoreCandidate(left) || left.channelId - right.channelId)[0]!
    : selectWeighted(bucketRows)!;
  applyDecisionProbability(candidates, bucketRows, route.routingStrategy);

  return {
    requestedModel,
    actualModel: selected.sourceModel || requestedModel,
    matched: true,
    routeId,
    modelPattern: route.modelPattern,
    displayName: route.displayName,
    routingStrategy: route.routingStrategy,
    selectedChannelId: selected.channelId,
    selectedAccountId: selected.accountId,
    priority,
    summary: [
      `命中模型：${route.modelPattern}`,
      ...(options.forcedChannelId ? [`指定通道：#${options.forcedChannelId}`] : []),
      `策略：${route.routingStrategy}`,
      `优先级桶：${priority}`,
      route.routingStrategy === 'weighted' ? '按权重随机选择，本接口返回一次模拟结果' : '稳定优先选择最高分通道'
    ],
    candidates,
    filtered
  };
}

export async function recordChannelSuccess(channelId: number, latencyMs: number, estimatedCost = 0): Promise<void> {
  await db
    .update(schema.routeChannels)
    .set({
      successCount: sql`${schema.routeChannels.successCount} + 1`,
      consecutiveFailCount: 0,
      cooldownLevel: 0,
      cooldownUntil: null,
      totalLatencyMs: sql`${schema.routeChannels.totalLatencyMs} + ${latencyMs}`,
      totalCost: sql`${schema.routeChannels.totalCost} + ${Math.max(0, estimatedCost)}`,
      lastUsedAt: nowIso()
    })
    .where(eq(schema.routeChannels.id, channelId))
    .run();
  clearTokenRouterCache();
}

export async function recordChannelFailure(channelId: number, reason: string, options: ChannelFailureOptions = {}): Promise<void> {
  const channel = await db.select().from(schema.routeChannels).where(eq(schema.routeChannels.id, channelId)).get();
  if (!channel) return;
  const nextFailCount = channel.consecutiveFailCount + 1;
  const hasTemporaryDisable = !!options.cooldownUntil;
  const cooldownUntil = options.cooldownUntil ?? channel.cooldownUntil;
  await db
    .update(schema.routeChannels)
    .set({
      failCount: sql`${schema.routeChannels.failCount} + 1`,
      consecutiveFailCount: nextFailCount,
      // 只有系统临时禁用规则命中后才持久冷却；普通失败只影响本次请求排除和后续失败惩罚。
      cooldownLevel: hasTemporaryDisable ? Math.min(3, nextFailCount) : channel.cooldownLevel,
      cooldownUntil,
      lastFailAt: nowIso()
    })
    .where(eq(schema.routeChannels.id, channelId))
    .run();
  clearTokenRouterCache();

  await db.insert(schema.events).values({
    type: 'proxy',
    title: options.eventTitle ?? (hasTemporaryDisable ? '上游通道临时禁用' : '上游通道请求失败'),
    message: reason,
    level: options.eventLevel ?? (hasTemporaryDisable || nextFailCount >= 3 ? 'warning' : 'info'),
    relatedId: channelId,
    relatedType: 'route_channel',
    createdAt: nowIso()
  }).run();
}

async function loadCandidateRows(): Promise<CandidateRow[]> {
  const now = Date.now();
  if (candidateRowsCache && candidateRowsCache.expiresAt > now) {
    return candidateRowsCache.rows;
  }
  const rows = await loadCandidateRowsFromDb();
  candidateRowsCache = {
    rows,
    expiresAt: now + config.tokenRouterCacheTtlMs
  };
  return rows;
}

async function loadCandidateRowsFromDb(): Promise<CandidateRow[]> {
  const rows = await db
    .select({
      routeId: schema.tokenRoutes.id,
      modelPattern: schema.tokenRoutes.modelPattern,
      displayName: schema.tokenRoutes.displayName,
      routeMode: schema.tokenRoutes.routeMode,
      routingStrategy: schema.tokenRoutes.routingStrategy,
      channelId: schema.routeChannels.id,
      accountId: schema.routeChannels.accountId,
      tokenId: schema.routeChannels.tokenId,
      sourceModel: schema.routeChannels.sourceModel,
      priority: schema.routeChannels.priority,
      weight: schema.routeChannels.weight,
      failCount: schema.routeChannels.failCount,
      consecutiveFailCount: schema.routeChannels.consecutiveFailCount,
      cooldownUntil: schema.routeChannels.cooldownUntil,
      accountStatus: schema.accounts.status,
      accountName: schema.accounts.username,
      accountApiToken: schema.accounts.apiToken,
      accountUnitCost: schema.accounts.unitCost,
      accountBaseUrl: schema.accounts.baseUrl,
      accountPlatform: schema.accounts.platform,
      accountProxyUrl: schema.accounts.proxyUrl,
      accountCustomHeaders: schema.accounts.customHeaders,
      tokenValue: schema.accountTokens.token,
      tokenName: schema.accountTokens.name,
      tokenEnabled: schema.accountTokens.enabled,
      tokenStatus: schema.accountTokens.valueStatus
    })
    .from(schema.routeChannels)
    .innerJoin(schema.tokenRoutes, eq(schema.tokenRoutes.id, schema.routeChannels.routeId))
    .innerJoin(schema.accounts, eq(schema.accounts.id, schema.routeChannels.accountId))
    .leftJoin(schema.accountTokens, eq(schema.accountTokens.id, schema.routeChannels.tokenId))
    .where(and(eq(schema.tokenRoutes.enabled, true), eq(schema.routeChannels.enabled, true), isNull(schema.routeChannels.tokenId)))
    .orderBy(asc(schema.routeChannels.priority), desc(schema.routeChannels.weight), asc(schema.routeChannels.id))
    .all();
  const rowsWithCredentials = await Promise.all(rows.map(resolveAccountLevelCredential));
  return rowsWithCredentials;
}

async function resolveAccountLevelCredential(row: CandidateRow): Promise<CandidateRow> {
  if (row.tokenId !== null || row.tokenValue || row.accountApiToken) return row;
  const credential = await resolveDefaultAccountCredential(row.accountId, { apiToken: row.accountApiToken });
  if (!credential) return row;
  return {
    ...row,
    accountApiToken: credential.token
  };
}

function routeMatches(row: CandidateRow, model: string): boolean {
  if (row.displayName === model) return true;
  if (row.routeMode === 'pattern') return wildcardMatches(row.modelPattern, model);
  if (row.routeMode === 'regex') return regexMatches(row.modelPattern, model);
  return row.modelPattern === model;
}

function wildcardMatches(pattern: string, model: string): boolean {
  const escaped = pattern.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${escaped}$`).test(model);
}

function regexMatches(pattern: string, model: string): boolean {
  try {
    return new RegExp(pattern).test(model);
  } catch {
    return false;
  }
}

function isCandidateUsable(row: CandidateRow): boolean {
  if (row.accountStatus !== 'active') return false;
  if (!row.tokenValue && !row.accountApiToken) return false;
  if (row.cooldownUntil && Date.parse(row.cooldownUntil) > Date.now()) return false;
  return true;
}

function buildDecisionCandidate(
  row: CandidateRow,
  requestedModel: string,
  policy: DownstreamRoutingPolicy,
  excludedChannelIds: number[],
  options: RouteSelectionOptions
): RouteDecisionCandidate {
  const reasons: string[] = [];
  if (excludedChannelIds.includes(row.channelId)) reasons.push('excluded_channel');
  if (options.forcedChannelId && row.channelId !== options.forcedChannelId) reasons.push('not_forced_channel');
  if (!routeMatches(row, requestedModel)) reasons.push('model_mismatch');
  if (row.accountStatus !== 'active') reasons.push('account_inactive');
  if (!row.tokenValue && !row.accountApiToken) reasons.push('missing_account_api_key');
  if (!isModelAllowedByPolicy(requestedModel, row.routeId, policy)) reasons.push('model_denied_by_downstream_key');
  if (!isCredentialAllowed(policy, { accountId: row.accountId, tokenId: row.tokenId })) {
    reasons.push('account_denied_by_downstream_key');
  }
  if (row.cooldownUntil && Date.parse(row.cooldownUntil) > Date.now()) reasons.push('cooldown');

  const available = reasons.length === 0;
  const score = available ? scoreCandidate(row) : 0;
  return {
    channelId: row.channelId,
    accountId: row.accountId,
    accountName: row.accountName,
    baseUrl: row.accountBaseUrl,
    platform: row.accountPlatform,
    priority: row.priority,
    weight: row.weight,
    score,
    probability: 0,
    available,
    reasons: available
      ? [`weight=${row.weight}`, `failPenalty=${Math.pow(0.5, row.consecutiveFailCount)}`]
      : reasons,
    cooldownUntil: row.cooldownUntil
  };
}

function applyDecisionProbability(
  candidates: RouteDecisionCandidate[],
  bucketRows: CandidateRow[],
  routingStrategy: string
): void {
  const scores = bucketRows.map((row) => ({ channelId: row.channelId, score: Math.max(0.01, scoreCandidate(row)) }));
  const total = scores.reduce((sum, item) => sum + item.score, 0);
  const selectedStableFirstId = routingStrategy === 'stable_first'
    ? [...bucketRows].sort((left, right) => scoreCandidate(right) - scoreCandidate(left) || left.channelId - right.channelId)[0]?.channelId
    : null;

  for (const item of candidates) {
    const score = scores.find((candidate) => candidate.channelId === item.channelId);
    if (!score) continue;
    item.probability = routingStrategy === 'stable_first'
      ? item.channelId === selectedStableFirstId ? 1 : 0
      : total > 0 ? Number((score.score / total).toFixed(4)) : 0;
  }
}

function scoreCandidate(row: CandidateRow): number {
  const failPenalty = Math.pow(0.5, row.consecutiveFailCount);
  return row.weight * failPenalty;
}

function selectWeighted(rows: CandidateRow[]): CandidateRow | null {
  if (rows.length === 0) return null;
  if (rows[0]?.routingStrategy === 'stable_first') {
    return [...rows].sort((left, right) => scoreCandidate(right) - scoreCandidate(left) || left.channelId - right.channelId)[0] ?? null;
  }
  const scored = rows.map((row) => ({ row, score: Math.max(0.01, scoreCandidate(row)) }));
  const total = scored.reduce((sum, item) => sum + item.score, 0);
  let cursor = Math.random() * total;
  for (const item of scored) {
    cursor -= item.score;
    if (cursor <= 0) return item.row;
  }
  return scored[0]?.row ?? null;
}
