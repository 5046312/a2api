import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { config } from '../config.js';
import { db, schema } from '../db/index.js';
import { parseJsonObject } from '../shared/json.js';
import { isModelDisabled } from '../shared/modelMatch.js';
import { nowIso } from '../shared/time.js';
import { resolveDefaultAccountCredential } from './accountTokenService.js';
import { GLOBAL_ROUTING_POLICY, isCredentialAllowed, isModelAllowedByPolicy, type DownstreamRoutingPolicy } from './downstreamPolicy.js';

export type SelectedChannel = {
  routeId: number;
  channelId: number;
  accountId: number;
  tokenId: number | null;
  siteId: number;
  siteName: string;
  siteUrl: string;
  sitePlatform: string;
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
  tokenId: number | null;
  siteId: number;
  siteName: string;
  accountName: string | null;
  tokenName: string | null;
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
  selectedSiteId: number | null;
  priority: number | null;
  summary: string[];
  candidates: RouteDecisionCandidate[];
  filtered: Array<{ channelId: number; reason: string }>;
};

export type RouteSelectionOptions = {
  forcedChannelId?: number | null;
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
  accountExtraConfig: string | null;
  siteId: number;
  siteName: string;
  siteUrl: string;
  sitePlatform: string;
  siteStatus: string;
  siteWeight: number;
  siteProxyUrl: string | null;
  siteCustomHeaders: string | null;
  siteDisabledModels: string[];
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
    if (!isCredentialAllowed(policy, { siteId: row.siteId, accountId: row.accountId, tokenId: row.tokenId })) continue;
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
    .filter((row) => isCredentialAllowed(policy, { siteId: row.siteId, accountId: row.accountId, tokenId: row.tokenId }));

  if (candidates.length === 0) return null;

  candidates.sort((left, right) => {
    if (left.priority !== right.priority) return left.priority - right.priority;
    return scoreCandidate(right, policy) - scoreCandidate(left, policy);
  });

  const bucketPriority = candidates[0]?.priority ?? 0;
  const bucket = candidates.filter((item) => item.priority === bucketPriority);
  const selected = selectWeighted(bucket, policy);
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
    siteId: selected.siteId,
    siteName: selected.siteName,
    siteUrl: selected.siteUrl,
    sitePlatform: selected.sitePlatform,
    customHeaders: parseJsonObject(selected.siteCustomHeaders) as Record<string, string> | null,
    proxyUrl: accountProxyUrl(selected.accountExtraConfig) || selected.siteProxyUrl,
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
      selectedSiteId: null,
      priority: null,
      summary: ['未找到启用路由或启用通道'],
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
      selectedSiteId: null,
      priority: null,
      summary: options.forcedChannelId
        ? [`命中路由，但指定通道 #${options.forcedChannelId} 不可用`]
        : ['命中路由，但没有可用通道'],
      candidates,
      filtered
    };
  }

  const priority = Math.min(...availableRows.map((row) => row.priority));
  const bucketRows = availableRows.filter((row) => row.priority === priority);
  const selected = route.routingStrategy === 'stable_first'
    ? [...bucketRows].sort((left, right) => scoreCandidate(right, policy) - scoreCandidate(left, policy) || left.channelId - right.channelId)[0]!
    : selectWeighted(bucketRows, policy)!;
  applyDecisionProbability(candidates, bucketRows, policy, route.routingStrategy);

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
    selectedSiteId: selected.siteId,
    priority,
    summary: [
      `命中路由：${route.modelPattern}`,
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

export async function recordChannelFailure(channelId: number, reason: string): Promise<void> {
  const channel = await db.select().from(schema.routeChannels).where(eq(schema.routeChannels.id, channelId)).get();
  if (!channel) return;
  const nextFailCount = channel.consecutiveFailCount + 1;
  const cooldownMs = nextFailCount <= 1 ? 30_000 : nextFailCount === 2 ? 5 * 60_000 : 30 * 60_000;
  await db
    .update(schema.routeChannels)
    .set({
      failCount: sql`${schema.routeChannels.failCount} + 1`,
      consecutiveFailCount: nextFailCount,
      cooldownLevel: Math.min(3, nextFailCount),
      cooldownUntil: new Date(Date.now() + cooldownMs).toISOString(),
      lastFailAt: nowIso()
    })
    .where(eq(schema.routeChannels.id, channelId))
    .run();
  clearTokenRouterCache();

  await db.insert(schema.events).values({
    type: 'proxy',
    title: '上游通道进入冷却',
    message: reason,
    level: nextFailCount >= 3 ? 'warning' : 'info',
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
      accountExtraConfig: schema.accounts.extraConfig,
      siteId: schema.sites.id,
      siteName: schema.sites.name,
      siteUrl: schema.sites.url,
      sitePlatform: schema.sites.platform,
      siteStatus: schema.sites.status,
      siteWeight: schema.sites.globalWeight,
      siteProxyUrl: schema.sites.proxyUrl,
      siteCustomHeaders: schema.sites.customHeaders,
      tokenValue: schema.accountTokens.token,
      tokenName: schema.accountTokens.name,
      tokenEnabled: schema.accountTokens.enabled,
      tokenStatus: schema.accountTokens.valueStatus
    })
    .from(schema.routeChannels)
    .innerJoin(schema.tokenRoutes, eq(schema.tokenRoutes.id, schema.routeChannels.routeId))
    .innerJoin(schema.accounts, eq(schema.accounts.id, schema.routeChannels.accountId))
    .innerJoin(schema.sites, eq(schema.sites.id, schema.accounts.siteId))
    .leftJoin(schema.accountTokens, eq(schema.accountTokens.id, schema.routeChannels.tokenId))
    .where(and(eq(schema.tokenRoutes.enabled, true), eq(schema.routeChannels.enabled, true)))
    .orderBy(asc(schema.routeChannels.priority), desc(schema.routeChannels.weight), asc(schema.routeChannels.id))
    .all();
  const disabledBySiteId = await loadDisabledModelsBySiteId();
  const rowsWithCredentials = await Promise.all(rows.map(resolveAccountLevelCredential));
  return rowsWithCredentials.map((row) => ({
    ...row,
    siteDisabledModels: disabledBySiteId.get(row.siteId) || []
  }));
}

async function resolveAccountLevelCredential(row: Omit<CandidateRow, 'siteDisabledModels'>): Promise<Omit<CandidateRow, 'siteDisabledModels'>> {
  if (row.tokenId !== null || row.tokenValue || row.accountApiToken) return row;
  const credential = await resolveDefaultAccountCredential(row.accountId, { apiToken: row.accountApiToken });
  if (!credential) return row;
  return {
    ...row,
    accountApiToken: credential.token,
    tokenName: row.tokenName || 'default'
  };
}

async function loadDisabledModelsBySiteId(): Promise<Map<number, string[]>> {
  const rows = await db.select().from(schema.siteDisabledModels).all();
  const output = new Map<number, string[]>();
  for (const row of rows) {
    const current = output.get(row.siteId) || [];
    current.push(row.modelName);
    output.set(row.siteId, current);
  }
  return output;
}

function accountProxyUrl(extraConfig: string | null): string | null {
  const parsed = parseJsonObject(extraConfig);
  const value = parsed?.proxyUrl;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
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
  if (row.siteStatus !== 'active') return false;
  if (row.accountStatus !== 'active') return false;
  if (isModelDisabled(row.sourceModel || row.modelPattern, row.siteDisabledModels)) return false;
  if (row.tokenId !== null && (!row.tokenEnabled || row.tokenStatus !== 'ready')) return false;
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
  if (row.siteStatus !== 'active') reasons.push('site_inactive');
  if (row.accountStatus !== 'active') reasons.push('account_inactive');
  if (isModelDisabled(row.sourceModel || row.modelPattern, row.siteDisabledModels)) reasons.push('site_model_disabled');
  if (row.tokenId !== null && !row.tokenEnabled) reasons.push('token_disabled');
  if (row.tokenId !== null && row.tokenStatus !== 'ready') reasons.push('token_not_ready');
  if (!row.tokenValue && !row.accountApiToken) reasons.push('missing_credential');
  if (!isModelAllowedByPolicy(requestedModel, row.routeId, policy)) reasons.push('model_denied_by_downstream_key');
  if (!isCredentialAllowed(policy, { siteId: row.siteId, accountId: row.accountId, tokenId: row.tokenId })) {
    reasons.push('credential_denied_by_downstream_key');
  }
  if (row.cooldownUntil && Date.parse(row.cooldownUntil) > Date.now()) reasons.push('cooldown');

  const available = reasons.length === 0;
  const score = available ? scoreCandidate(row, policy) : 0;
  return {
    channelId: row.channelId,
    accountId: row.accountId,
    tokenId: row.tokenId,
    siteId: row.siteId,
    siteName: row.siteName,
    accountName: row.accountName,
    tokenName: row.tokenName,
    priority: row.priority,
    weight: row.weight,
    score,
    probability: 0,
    available,
    reasons: available
      ? [`weight=${row.weight}`, `siteWeight=${row.siteWeight}`, `failPenalty=${Math.pow(0.5, row.consecutiveFailCount)}`]
      : reasons,
    cooldownUntil: row.cooldownUntil
  };
}

function applyDecisionProbability(
  candidates: RouteDecisionCandidate[],
  bucketRows: CandidateRow[],
  policy: DownstreamRoutingPolicy,
  routingStrategy: string
): void {
  const scores = bucketRows.map((row) => ({ channelId: row.channelId, score: Math.max(0.01, scoreCandidate(row, policy)) }));
  const total = scores.reduce((sum, item) => sum + item.score, 0);
  const selectedStableFirstId = routingStrategy === 'stable_first'
    ? [...bucketRows].sort((left, right) => scoreCandidate(right, policy) - scoreCandidate(left, policy) || left.channelId - right.channelId)[0]?.channelId
    : null;

  for (const item of candidates) {
    const score = scores.find((candidate) => candidate.channelId === item.channelId);
    if (!score) continue;
    item.probability = routingStrategy === 'stable_first'
      ? item.channelId === selectedStableFirstId ? 1 : 0
      : total > 0 ? Number((score.score / total).toFixed(4)) : 0;
  }
}

function scoreCandidate(row: CandidateRow, policy: DownstreamRoutingPolicy): number {
  const siteMultiplier = policy.siteWeightMultipliers[String(row.siteId)] ?? 1;
  const failPenalty = Math.pow(0.5, row.consecutiveFailCount);
  return row.weight * row.siteWeight * siteMultiplier * failPenalty;
}

function selectWeighted(rows: CandidateRow[], policy: DownstreamRoutingPolicy): CandidateRow | null {
  if (rows.length === 0) return null;
  if (rows[0]?.routingStrategy === 'stable_first') {
    return [...rows].sort((left, right) => scoreCandidate(right, policy) - scoreCandidate(left, policy) || left.channelId - right.channelId)[0] ?? null;
  }
  const scored = rows.map((row) => ({ row, score: Math.max(0.01, scoreCandidate(row, policy)) }));
  const total = scored.reduce((sum, item) => sum + item.score, 0);
  let cursor = Math.random() * total;
  for (const item of scored) {
    cursor -= item.score;
    if (cursor <= 0) return item.row;
  }
  return scored[0]?.row ?? null;
}
