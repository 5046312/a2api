import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const accounts = sqliteTable(
  'accounts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    username: text('username'),
    baseUrl: text('base_url').notNull().default(''),
    platform: text('platform').notNull().default('openai'),
    proxyUrl: text('proxy_url'),
    useSystemProxy: integer('use_system_proxy', { mode: 'boolean' }).notNull().default(false),
    customHeaders: text('custom_headers'),
    credentialMode: text('credential_mode').notNull().default('apikey'),
    accessToken: text('access_token'),
    apiToken: text('api_token'),
    balance: real('balance').notNull().default(0),
    balanceUsed: real('balance_used').notNull().default(0),
    quota: real('quota').notNull().default(0),
    unitCost: real('unit_cost'),
    valueScore: real('value_score').notNull().default(0),
    status: text('status').notNull().default('active'),
    isPinned: integer('is_pinned', { mode: 'boolean' }).notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    lastBalanceRefresh: text('last_balance_refresh'),
    oauthProvider: text('oauth_provider'),
    oauthAccountKey: text('oauth_account_key'),
    oauthProjectId: text('oauth_project_id'),
    extraConfig: text('extra_config'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull()
  },
  (table) => ({
    platformIndex: index('accounts_platform_idx').on(table.platform),
    statusIndex: index('accounts_status_idx').on(table.status),
    platformStatusIndex: index('accounts_platform_status_idx').on(table.platform, table.status)
  })
);

export const accountTokens = sqliteTable(
  'account_tokens',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    accountId: integer('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    token: text('token').notNull(),
    tokenGroup: text('token_group'),
    valueStatus: text('value_status').notNull().default('ready'),
    source: text('source').notNull().default('manual'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
    localNameLocked: integer('local_name_locked', { mode: 'boolean' }).notNull().default(false),
    localStatusLocked: integer('local_status_locked', { mode: 'boolean' }).notNull().default(true),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull()
  },
  (table) => ({
    accountIndex: index('account_tokens_account_idx').on(table.accountId),
    enabledIndex: index('account_tokens_enabled_idx').on(table.enabled)
  })
);

export const modelAvailability = sqliteTable(
  'model_availability',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    accountId: integer('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
    modelName: text('model_name').notNull(),
    available: integer('available', { mode: 'boolean' }).notNull().default(true),
    isManual: integer('is_manual', { mode: 'boolean' }).notNull().default(false),
    latencyMs: integer('latency_ms'),
    contextLength: integer('context_length'),
    checkedAt: text('checked_at').notNull()
  },
  (table) => ({
    accountModelUnique: uniqueIndex('model_availability_account_model_unique').on(table.accountId, table.modelName),
    modelIndex: index('model_availability_model_idx').on(table.modelName)
  })
);

export const tokenModelAvailability = sqliteTable(
  'token_model_availability',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tokenId: integer('token_id').notNull().references(() => accountTokens.id, { onDelete: 'cascade' }),
    modelName: text('model_name').notNull(),
    available: integer('available', { mode: 'boolean' }).notNull().default(true),
    latencyMs: integer('latency_ms'),
    contextLength: integer('context_length'),
    checkedAt: text('checked_at').notNull()
  },
  (table) => ({
    tokenModelUnique: uniqueIndex('token_model_availability_token_model_unique').on(table.tokenId, table.modelName),
    modelIndex: index('token_model_availability_model_idx').on(table.modelName)
  })
);

export const tokenRoutes = sqliteTable(
  'token_routes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    modelPattern: text('model_pattern').notNull(),
    displayName: text('display_name'),
    routeMode: text('route_mode').notNull().default('exact'),
    modelMapping: text('model_mapping'),
    routingStrategy: text('routing_strategy').notNull().default('weighted'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    manualOverride: integer('manual_override', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull()
  },
  (table) => ({
    modelIndex: index('token_routes_model_idx').on(table.modelPattern),
    enabledIndex: index('token_routes_enabled_idx').on(table.enabled)
  })
);

export const routeChannels = sqliteTable(
  'route_channels',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    routeId: integer('route_id').notNull().references(() => tokenRoutes.id, { onDelete: 'cascade' }),
    accountId: integer('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
    tokenId: integer('token_id').references(() => accountTokens.id, { onDelete: 'set null' }),
    sourceModel: text('source_model'),
    priority: integer('priority').notNull().default(0),
    weight: integer('weight').notNull().default(10),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    manualOverride: integer('manual_override', { mode: 'boolean' }).notNull().default(false),
    successCount: integer('success_count').notNull().default(0),
    failCount: integer('fail_count').notNull().default(0),
    totalLatencyMs: integer('total_latency_ms').notNull().default(0),
    totalCost: real('total_cost').notNull().default(0),
    lastUsedAt: text('last_used_at'),
    lastSelectedAt: text('last_selected_at'),
    lastFailAt: text('last_fail_at'),
    consecutiveFailCount: integer('consecutive_fail_count').notNull().default(0),
    cooldownLevel: integer('cooldown_level').notNull().default(0),
    cooldownUntil: text('cooldown_until')
  },
  (table) => ({
    routeIndex: index('route_channels_route_idx').on(table.routeId),
    accountIndex: index('route_channels_account_idx').on(table.accountId),
    tokenIndex: index('route_channels_token_idx').on(table.tokenId),
    routeEnabledIndex: index('route_channels_route_enabled_idx').on(table.routeId, table.enabled)
  })
);

export const routeGroupSources = sqliteTable(
  'route_group_sources',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    groupRouteId: integer('group_route_id').notNull().references(() => tokenRoutes.id, { onDelete: 'cascade' }),
    sourceRouteId: integer('source_route_id').notNull().references(() => tokenRoutes.id, { onDelete: 'cascade' }),
    createdAt: text('created_at').notNull()
  },
  (table) => ({
    groupSourceUnique: uniqueIndex('route_group_sources_unique').on(table.groupRouteId, table.sourceRouteId),
    groupIndex: index('route_group_sources_group_idx').on(table.groupRouteId)
  })
);

export const routeDecisionSnapshots = sqliteTable(
  'route_decision_snapshots',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    routeId: integer('route_id').notNull().references(() => tokenRoutes.id, { onDelete: 'cascade' }),
    requestedModel: text('requested_model').notNull(),
    snapshotJson: text('snapshot_json').notNull(),
    refreshedAt: text('refreshed_at').notNull()
  },
  (table) => ({
    routeUnique: uniqueIndex('route_decision_snapshots_route_unique').on(table.routeId),
    refreshedIndex: index('route_decision_snapshots_refreshed_idx').on(table.refreshedAt)
  })
);

export const downstreamApiKeys = sqliteTable(
  'downstream_api_keys',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    key: text('key').notNull(),
    description: text('description'),
    groupName: text('group_name'),
    tags: text('tags').notNull().default('[]'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    expiresAt: text('expires_at'),
    maxCost: real('max_cost'),
    usedCost: real('used_cost').notNull().default(0),
    maxRequests: integer('max_requests'),
    usedRequests: integer('used_requests').notNull().default(0),
    modelScope: text('model_scope').notNull().default('selected'),
    supportedModels: text('supported_models').notNull().default('[]'),
    allowedRouteIds: text('allowed_route_ids').notNull().default('[]'),
    allowedCredentialRefs: text('allowed_credential_refs').notNull().default('[]'),
    excludedCredentialRefs: text('excluded_credential_refs').notNull().default('[]'),
    lastUsedAt: text('last_used_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull()
  },
  (table) => ({
    keyUnique: uniqueIndex('downstream_api_keys_key_unique').on(table.key),
    enabledIndex: index('downstream_api_keys_enabled_idx').on(table.enabled),
    expiresIndex: index('downstream_api_keys_expires_idx').on(table.expiresAt)
  })
);

export const proxyLogs = sqliteTable(
  'proxy_logs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    routeId: integer('route_id'),
    channelId: integer('channel_id'),
    accountId: integer('account_id'),
    downstreamApiKeyId: integer('downstream_api_key_id'),
    modelRequested: text('model_requested'),
    modelActual: text('model_actual'),
    status: text('status').notNull(),
    httpStatus: integer('http_status'),
    isStream: integer('is_stream', { mode: 'boolean' }).notNull().default(false),
    firstByteLatencyMs: integer('first_byte_latency_ms'),
    latencyMs: integer('latency_ms'),
    promptTokens: integer('prompt_tokens').notNull().default(0),
    completionTokens: integer('completion_tokens').notNull().default(0),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
    totalTokens: integer('total_tokens').notNull().default(0),
    estimatedCost: real('estimated_cost').notNull().default(0),
    billingDetails: text('billing_details'),
    debugTraceId: integer('debug_trace_id'),
    errorMessage: text('error_message'),
    retryCount: integer('retry_count').notNull().default(0),
    createdAt: text('created_at').notNull()
  },
  (table) => ({
    createdIndex: index('proxy_logs_created_idx').on(table.createdAt),
    statusCreatedIndex: index('proxy_logs_status_created_idx').on(table.status, table.createdAt),
    modelCreatedIndex: index('proxy_logs_model_created_idx').on(table.modelActual, table.createdAt)
  })
);

export const proxyDebugTraces = sqliteTable(
  'proxy_debug_traces',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    downstreamPath: text('downstream_path').notNull(),
    clientKind: text('client_kind'),
    sessionId: text('session_id'),
    traceHint: text('trace_hint'),
    requestedModel: text('requested_model'),
    downstreamApiKeyId: integer('downstream_api_key_id'),
    requestHeadersJson: text('request_headers_json'),
    selectedChannelId: integer('selected_channel_id'),
    selectedRouteId: integer('selected_route_id'),
    selectedAccountId: integer('selected_account_id'),
    decisionSummaryJson: text('decision_summary_json'),
    finalStatus: text('final_status'),
    finalHttpStatus: integer('final_http_status'),
    finalUpstreamPath: text('final_upstream_path'),
    finalResponseHeadersJson: text('final_response_headers_json'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull()
  },
  (table) => ({
    createdIndex: index('proxy_debug_traces_created_idx').on(table.createdAt),
    sessionCreatedIndex: index('proxy_debug_traces_session_created_idx').on(table.sessionId, table.createdAt),
    modelCreatedIndex: index('proxy_debug_traces_model_created_idx').on(table.requestedModel, table.createdAt),
    statusCreatedIndex: index('proxy_debug_traces_status_created_idx').on(table.finalStatus, table.createdAt)
  })
);

export const proxyDebugAttempts = sqliteTable(
  'proxy_debug_attempts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    traceId: integer('trace_id').notNull().references(() => proxyDebugTraces.id, { onDelete: 'cascade' }),
    attemptIndex: integer('attempt_index').notNull(),
    channelId: integer('channel_id'),
    routeId: integer('route_id'),
    accountId: integer('account_id'),
    modelActual: text('model_actual'),
    selectionRandom: real('selection_random'),
    selectionProbability: real('selection_probability'),
    selectionCandidatesJson: text('selection_candidates_json'),
    endpoint: text('endpoint').notNull(),
    requestPath: text('request_path').notNull(),
    targetUrl: text('target_url').notNull(),
    runtimeExecutor: text('runtime_executor'),
    requestHeadersJson: text('request_headers_json'),
    responseStatus: integer('response_status'),
    responseHeadersJson: text('response_headers_json'),
    rawErrorText: text('raw_error_text'),
    recoverApplied: integer('recover_applied', { mode: 'boolean' }).notNull().default(false),
    downgradeDecision: integer('downgrade_decision', { mode: 'boolean' }).notNull().default(false),
    downgradeReason: text('downgrade_reason'),
    createdAt: text('created_at').notNull()
  },
  (table) => ({
    traceAttemptUnique: uniqueIndex('proxy_debug_attempts_trace_attempt_unique').on(table.traceId, table.attemptIndex),
    traceCreatedIndex: index('proxy_debug_attempts_trace_created_idx').on(table.traceId, table.createdAt)
  })
);

export const proxyFiles = sqliteTable(
  'proxy_files',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    publicId: text('public_id').notNull(),
    ownerType: text('owner_type').notNull(),
    ownerId: text('owner_id').notNull(),
    filename: text('filename').notNull(),
    mimeType: text('mime_type').notNull(),
    purpose: text('purpose'),
    byteSize: integer('byte_size').notNull(),
    sha256: text('sha256').notNull(),
    contentBase64: text('content_base64').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    deletedAt: text('deleted_at')
  },
  (table) => ({
    publicIdUnique: uniqueIndex('proxy_files_public_id_unique').on(table.publicId),
    ownerLookupIndex: index('proxy_files_owner_lookup_idx').on(table.ownerType, table.ownerId, table.deletedAt)
  })
);

export const proxyVideoTasks = sqliteTable(
  'proxy_video_tasks',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    publicId: text('public_id').notNull(),
    upstreamVideoId: text('upstream_video_id').notNull(),
    upstreamUrl: text('upstream_url').notNull(),
    tokenRef: text('token_ref').notNull(),
    requestedModel: text('requested_model'),
    actualModel: text('actual_model'),
    channelId: integer('channel_id'),
    accountId: integer('account_id'),
    statusSnapshot: text('status_snapshot'),
    upstreamResponseMeta: text('upstream_response_meta'),
    lastUpstreamStatus: integer('last_upstream_status'),
    lastPolledAt: text('last_polled_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull()
  },
  (table) => ({
    publicIdUnique: uniqueIndex('proxy_video_tasks_public_id_unique').on(table.publicId),
    upstreamVideoIdIndex: index('proxy_video_tasks_upstream_video_id_idx').on(table.upstreamVideoId),
    createdIndex: index('proxy_video_tasks_created_at_idx').on(table.createdAt)
  })
);

export const accountMonitors = sqliteTable(
  'account_monitors',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    accountId: integer('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    intervalSec: integer('interval_sec'),
    status: text('status').notNull().default('pending'),
    lastCheckAt: text('last_check_at'),
    lastUpAt: text('last_up_at'),
    lastDownAt: text('last_down_at'),
    nextCheckAt: text('next_check_at'),
    consecutiveFailCount: integer('consecutive_fail_count').notNull().default(0),
    consecutiveSuccessCount: integer('consecutive_success_count').notNull().default(0),
    latencyMs: integer('latency_ms'),
    lastMessage: text('last_message'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull()
  },
  (table) => ({
    accountUnique: uniqueIndex('account_monitors_account_unique').on(table.accountId),
    statusIndex: index('account_monitors_status_idx').on(table.status),
    nextCheckIndex: index('account_monitors_next_check_idx').on(table.enabled, table.nextCheckAt)
  })
);

export const monitorHeartbeats = sqliteTable(
  'monitor_heartbeats',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    monitorId: integer('monitor_id').notNull().references(() => accountMonitors.id, { onDelete: 'cascade' }),
    accountId: integer('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
    status: text('status').notNull(),
    checkedAt: text('checked_at').notNull(),
    latencyMs: integer('latency_ms'),
    message: text('message'),
    retries: integer('retries').notNull().default(0),
    important: integer('important', { mode: 'boolean' }).notNull().default(false),
    errorType: text('error_type'),
    modelCount: integer('model_count')
  },
  (table) => ({
    monitorCheckedIndex: index('monitor_heartbeats_monitor_checked_idx').on(table.monitorId, table.checkedAt),
    accountCheckedIndex: index('monitor_heartbeats_account_checked_idx').on(table.accountId, table.checkedAt),
    statusCheckedIndex: index('monitor_heartbeats_status_checked_idx').on(table.status, table.checkedAt),
    importantIndex: index('monitor_heartbeats_important_idx').on(table.important, table.checkedAt)
  })
);

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value')
});

export const events = sqliteTable(
  'events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    type: text('type').notNull(),
    title: text('title').notNull(),
    message: text('message'),
    level: text('level').notNull().default('info'),
    read: integer('read', { mode: 'boolean' }).notNull().default(false),
    relatedId: integer('related_id'),
    relatedType: text('related_type'),
    createdAt: text('created_at').notNull()
  },
  (table) => ({
    readCreatedIndex: index('events_read_created_idx').on(table.read, table.createdAt),
    typeCreatedIndex: index('events_type_created_idx').on(table.type, table.createdAt)
  })
);

export const schema = {
  accounts,
  accountTokens,
  modelAvailability,
  tokenModelAvailability,
  tokenRoutes,
  routeChannels,
  routeGroupSources,
  routeDecisionSnapshots,
  downstreamApiKeys,
  proxyLogs,
  proxyDebugTraces,
  proxyDebugAttempts,
  proxyFiles,
  proxyVideoTasks,
  accountMonitors,
  monitorHeartbeats,
  settings,
  events
};
