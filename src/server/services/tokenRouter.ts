import { and, asc, desc, eq, isNull, lte, sql } from 'drizzle-orm';
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
  selectionRandom: number | null;
  selectionProbability: number | null;
  selectionCandidates: SelectionCandidateSnapshot[];
  routingStrategy: string;
  accountToken: string;
  accountUnitCost: number | null;
  sourceModel: string;
  requestedModel: string;
};

export type SelectionCandidateSnapshot = {
  channelId: number;
  accountId: number;
  accountName: string | null;
  sourceModel: string | null;
  priority: number;
  score: number;
  probability: number;
  selected: boolean;
};

export type RouteDecisionCandidate = {
  channelId: number;
  accountId: number;
  accountName: string | null;
  baseUrl: string;
  platform: string;
  priority: number;
  weight: number;
  consecutiveFailCount: number;
  failurePenalty: number;
  score: number;
  probability: number;
  available: boolean;
  cooldownUntil: string | null;
  failureResetAt: string | null;
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
  failureResetAt: string | null;
  failureResetMinutes: number;
  lastUsedAt: string | null;
  lastSelectedAt: string | null;
  lastFailAt: string | null;
  accountStatus: string;
  accountName: string | null;
  accountApiToken: string | null;
  accountUnitCost: number | null;
  modelUnitCost: number | null;
  accountBaseUrl: string;
  accountPlatform: string;
  accountProxyUrl: string | null;
  accountCustomHeaders: string | null;
  tokenValue: string | null;
  tokenName: string | null;
  tokenEnabled: boolean | null;
  tokenStatus: string | null;
};

type ChannelSelectionResult = {
  row: CandidateRow;
  selectionRandom: number | null;
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
  const selection = selectChannelFromBucket(bucket);
  if (!selection) return null;
  const selected = selection.row;
  const selectionCandidates = buildSelectionCandidateSnapshot(candidates, bucket, selected.channelId, selected.routingStrategy);
  const selectedCandidate = selectionCandidates.find((candidate) => candidate.selected) ?? null;
  const selectedAt = nowIso();

  await db
    .update(schema.routeChannels)
    .set({ lastSelectedAt: selectedAt })
    .where(eq(schema.routeChannels.id, selected.channelId))
    .run();
  syncCachedLastSelectedAt(selected.channelId, selectedAt);

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
    selectionRandom: selection.selectionRandom,
    selectionProbability: selectedCandidate?.probability ?? null,
    selectionCandidates,
    routingStrategy: selected.routingStrategy,
    accountToken,
    accountUnitCost: selected.modelUnitCost ?? selected.accountUnitCost,
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
      candidates: []
    };
  }

  const route = rows[0]!;
  const candidates = rows.map((row) => buildDecisionCandidate(row, requestedModel, policy, excludedChannelIds, options));
  const availableRows = rows.filter((row) => candidates.some((candidate) => candidate.channelId === row.channelId && candidate.available));

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
      candidates
    };
  }

  const priority = Math.min(...availableRows.map((row) => row.priority));
  const bucketRows = availableRows.filter((row) => row.priority === priority);
  const selection = selectChannelFromBucket(bucketRows)!;
  const selected = selection.row;
  applyDecisionProbability(candidates, bucketRows, selected.channelId, route.routingStrategy);

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
      routingStrategySummary(route.routingStrategy)
    ],
    candidates
  };
}

export async function recordChannelSuccess(channelId: number, latencyMs: number, estimatedCost = 0): Promise<void> {
  await db
    .update(schema.routeChannels)
    .set({
      successCount: sql`${schema.routeChannels.successCount} + 1`,
      consecutiveFailCount: 0,
      failureResetAt: null,
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
  await resetExpiredChannelFailures();
  const channel = await db
    .select({
      id: schema.routeChannels.id,
      consecutiveFailCount: schema.routeChannels.consecutiveFailCount,
      cooldownLevel: schema.routeChannels.cooldownLevel,
      cooldownUntil: schema.routeChannels.cooldownUntil,
      failureResetAt: schema.routeChannels.failureResetAt,
      failureResetMinutes: schema.tokenRoutes.failureResetMinutes
    })
    .from(schema.routeChannels)
    .innerJoin(schema.tokenRoutes, eq(schema.tokenRoutes.id, schema.routeChannels.routeId))
    .where(eq(schema.routeChannels.id, channelId))
    .get();
  if (!channel) return;
  const failedAt = nowIso();
  const nextFailCount = channel.consecutiveFailCount + 1;
  const hasTemporaryDisable = !!options.cooldownUntil;
  const cooldownUntil = options.cooldownUntil ?? channel.cooldownUntil;
  const failureResetAt = channel.failureResetAt
    || (channel.consecutiveFailCount === 0 ? buildFailureResetAt(failedAt, channel.failureResetMinutes) : null);
  await db
    .update(schema.routeChannels)
    .set({
      failCount: sql`${schema.routeChannels.failCount} + 1`,
      consecutiveFailCount: nextFailCount,
      failureResetAt,
      // 只有系统临时禁用规则命中后才持久冷却；普通失败只影响本次请求排除和后续失败惩罚。
      cooldownLevel: hasTemporaryDisable ? Math.min(3, nextFailCount) : channel.cooldownLevel,
      cooldownUntil,
      lastUsedAt: failedAt,
      lastFailAt: failedAt
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

export async function resetExpiredChannelFailures(): Promise<number> {
  const result = await db
    .update(schema.routeChannels)
    .set({
      consecutiveFailCount: 0,
      failureResetAt: null
    })
    .where(and(
      sql`${schema.routeChannels.failureResetAt} IS NOT NULL`,
      lte(schema.routeChannels.failureResetAt, nowIso())
    ))
    .run();
  if (result.changes > 0) clearTokenRouterCache();
  return result.changes;
}

async function loadCandidateRows(): Promise<CandidateRow[]> {
  await resetExpiredChannelFailures();
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
      failureResetAt: schema.routeChannels.failureResetAt,
      failureResetMinutes: schema.tokenRoutes.failureResetMinutes,
      lastUsedAt: schema.routeChannels.lastUsedAt,
      lastSelectedAt: schema.routeChannels.lastSelectedAt,
      lastFailAt: schema.routeChannels.lastFailAt,
      accountStatus: schema.accounts.status,
      accountName: schema.accounts.username,
      accountApiToken: schema.accounts.apiToken,
      accountUnitCost: schema.accounts.unitCost,
      modelUnitCost: schema.modelAvailability.modelCost,
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
    .leftJoin(schema.modelAvailability, and(
      eq(schema.modelAvailability.accountId, schema.routeChannels.accountId),
      eq(schema.modelAvailability.modelName, schema.routeChannels.sourceModel)
    ))
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
  const available = !(
    excludedChannelIds.includes(row.channelId) ||
    (options.forcedChannelId && row.channelId !== options.forcedChannelId) ||
    !routeMatches(row, requestedModel) ||
    row.accountStatus !== 'active' ||
    (!row.tokenValue && !row.accountApiToken) ||
    !isModelAllowedByPolicy(requestedModel, row.routeId, policy) ||
    !isCredentialAllowed(policy, { accountId: row.accountId, tokenId: row.tokenId }) ||
    !!(row.cooldownUntil && Date.parse(row.cooldownUntil) > Date.now())
  );
  const failurePenalty = Math.pow(0.5, row.consecutiveFailCount);
  const score = available ? scoreCandidate(row) : 0;
  return {
    channelId: row.channelId,
    accountId: row.accountId,
    accountName: row.accountName,
    baseUrl: row.accountBaseUrl,
    platform: row.accountPlatform,
    priority: row.priority,
    weight: row.weight,
    consecutiveFailCount: row.consecutiveFailCount,
    failurePenalty,
    score,
    probability: 0,
    available,
    cooldownUntil: row.cooldownUntil,
    failureResetAt: row.failureResetAt
  };
}

function buildFailureResetAt(failedAt: string, minutes: number): string | null {
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  return new Date(Date.parse(failedAt) + Math.trunc(minutes) * 60_000).toISOString();
}

function applyDecisionProbability(
  candidates: RouteDecisionCandidate[],
  bucketRows: CandidateRow[],
  selectedChannelId: number,
  routingStrategy: string
): void {
  const scores = bucketRows.map((row) => ({ channelId: row.channelId, score: Math.max(0.01, scoreCandidate(row)) }));
  const total = scores.reduce((sum, item) => sum + item.score, 0);
  const isDeterministicStrategy = routingStrategy === 'stable_first' || routingStrategy === 'round_robin';

  for (const item of candidates) {
    const score = scores.find((candidate) => candidate.channelId === item.channelId);
    if (!score) continue;
    item.probability = isDeterministicStrategy
      ? item.channelId === selectedChannelId ? 1 : 0
      : total > 0 ? Number((score.score / total).toFixed(4)) : 0;
  }
}

function buildSelectionCandidateSnapshot(
  candidates: CandidateRow[],
  bucketRows: CandidateRow[],
  selectedChannelId: number,
  routingStrategy: string
): SelectionCandidateSnapshot[] {
  const scores = bucketRows.map((row) => ({ channelId: row.channelId, score: Math.max(0.01, scoreCandidate(row)) }));
  const total = scores.reduce((sum, item) => sum + item.score, 0);
  const isDeterministicStrategy = routingStrategy === 'stable_first' || routingStrategy === 'round_robin';

  return candidates.map((row) => {
    const score = scores.find((candidate) => candidate.channelId === row.channelId);
    const probability = score
      ? isDeterministicStrategy
        ? row.channelId === selectedChannelId ? 1 : 0
        : total > 0 ? Number((score.score / total).toFixed(4)) : 0
      : 0;
    return {
      channelId: row.channelId,
      accountId: row.accountId,
      accountName: row.accountName,
      sourceModel: row.sourceModel,
      priority: row.priority,
      score: Number(scoreCandidate(row).toFixed(4)),
      probability,
      selected: row.channelId === selectedChannelId
    };
  });
}

function scoreCandidate(row: CandidateRow): number {
  const failPenalty = Math.pow(0.5, row.consecutiveFailCount);
  return row.weight * failPenalty;
}

function selectChannelFromBucket(rows: CandidateRow[]): ChannelSelectionResult | null {
  if (rows.length === 0) return null;
  if (rows[0]?.routingStrategy === 'stable_first') {
    const row = [...rows].sort((left, right) => scoreCandidate(right) - scoreCandidate(left) || left.channelId - right.channelId)[0] ?? null;
    return row ? { row, selectionRandom: null } : null;
  }
  if (rows[0]?.routingStrategy === 'round_robin') {
    const row = selectRoundRobinRow(rows);
    return row ? { row, selectionRandom: null } : null;
  }
  const scored = rows.map((row) => ({ row, score: Math.max(0.01, scoreCandidate(row)) }));
  const total = scored.reduce((sum, item) => sum + item.score, 0);
  const selectionRandom = Math.random();
  let cursor = selectionRandom * total;
  for (const item of scored) {
    cursor -= item.score;
    if (cursor <= 0) return { row: item.row, selectionRandom };
  }
  const row = scored[0]?.row ?? null;
  return row ? { row, selectionRandom } : null;
}

function selectRoundRobinRow(rows: CandidateRow[]): CandidateRow | null {
  return [...rows].sort((left, right) => {
    const lastAttemptDiff = lastAttemptTime(left) - lastAttemptTime(right);
    if (lastAttemptDiff !== 0) return lastAttemptDiff;
    return left.channelId - right.channelId;
  })[0] ?? null;
}

function lastAttemptTime(row: CandidateRow): number {
  return Math.max(dateTime(row.lastSelectedAt), dateTime(row.lastUsedAt), dateTime(row.lastFailAt));
}

function dateTime(value: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function syncCachedLastSelectedAt(channelId: number, selectedAt: string): void {
  if (!candidateRowsCache) return;
  candidateRowsCache.rows = candidateRowsCache.rows.map((row) => (row.channelId === channelId ? { ...row, lastSelectedAt: selectedAt } : row));
}

function routingStrategySummary(routingStrategy: string): string {
  if (routingStrategy === 'weighted') return '按权重随机选择，本接口返回一次模拟结果';
  if (routingStrategy === 'round_robin') return '轮询选择最久未命中的通道，本接口返回一次模拟结果';
  return '稳定优先选择最高分通道';
}
