import { sqlite } from './index.js';

// 迁移使用显式 SQL，避免首版启动依赖外部 migration 生成步骤。
export function runMigrations(): void {
  sqlite.exec(`
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  platform TEXT NOT NULL,
  proxy_url TEXT,
  use_system_proxy INTEGER NOT NULL DEFAULT 0,
  custom_headers TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  is_pinned INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  global_weight REAL NOT NULL DEFAULT 1,
  api_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(platform, url)
);
CREATE INDEX IF NOT EXISTS sites_status_idx ON sites(status);

CREATE TABLE IF NOT EXISTS site_api_endpoints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  cooldown_until TEXT,
  last_selected_at TEXT,
  last_failed_at TEXT,
  last_failure_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(site_id, url)
);
CREATE INDEX IF NOT EXISTS site_api_endpoints_enabled_idx ON site_api_endpoints(site_id, enabled, sort_order);
CREATE INDEX IF NOT EXISTS site_api_endpoints_cooldown_idx ON site_api_endpoints(site_id, cooldown_until);

CREATE TABLE IF NOT EXISTS site_disabled_models (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  model_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(site_id, model_name)
);
CREATE INDEX IF NOT EXISTS site_disabled_models_site_idx ON site_disabled_models(site_id);

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  username TEXT,
  credential_mode TEXT NOT NULL DEFAULT 'apikey',
  access_token TEXT,
  api_token TEXT,
  balance REAL NOT NULL DEFAULT 0,
  balance_used REAL NOT NULL DEFAULT 0,
  quota REAL NOT NULL DEFAULT 0,
  unit_cost REAL,
  value_score REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  is_pinned INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  last_balance_refresh TEXT,
  oauth_provider TEXT,
  oauth_account_key TEXT,
  oauth_project_id TEXT,
  extra_config TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS accounts_site_idx ON accounts(site_id);
CREATE INDEX IF NOT EXISTS accounts_status_idx ON accounts(status);
CREATE INDEX IF NOT EXISTS accounts_site_status_idx ON accounts(site_id, status);

CREATE TABLE IF NOT EXISTS account_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token TEXT NOT NULL,
  token_group TEXT,
  value_status TEXT NOT NULL DEFAULT 'ready',
  source TEXT NOT NULL DEFAULT 'manual',
  enabled INTEGER NOT NULL DEFAULT 1,
  is_default INTEGER NOT NULL DEFAULT 0,
  local_name_locked INTEGER NOT NULL DEFAULT 0,
  local_status_locked INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS account_tokens_account_idx ON account_tokens(account_id);
CREATE INDEX IF NOT EXISTS account_tokens_enabled_idx ON account_tokens(enabled);

CREATE TABLE IF NOT EXISTS model_availability (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  model_name TEXT NOT NULL,
  available INTEGER NOT NULL DEFAULT 1,
  is_manual INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER,
  context_length INTEGER,
  checked_at TEXT NOT NULL,
  UNIQUE(account_id, model_name)
);
CREATE INDEX IF NOT EXISTS model_availability_model_idx ON model_availability(model_name);

CREATE TABLE IF NOT EXISTS token_model_availability (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_id INTEGER NOT NULL REFERENCES account_tokens(id) ON DELETE CASCADE,
  model_name TEXT NOT NULL,
  available INTEGER NOT NULL DEFAULT 1,
  latency_ms INTEGER,
  context_length INTEGER,
  checked_at TEXT NOT NULL,
  UNIQUE(token_id, model_name)
);
CREATE INDEX IF NOT EXISTS token_model_availability_model_idx ON token_model_availability(model_name);

CREATE TABLE IF NOT EXISTS token_routes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model_pattern TEXT NOT NULL,
  display_name TEXT,
  route_mode TEXT NOT NULL DEFAULT 'exact',
  model_mapping TEXT,
  routing_strategy TEXT NOT NULL DEFAULT 'weighted',
  enabled INTEGER NOT NULL DEFAULT 1,
  manual_override INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS token_routes_model_idx ON token_routes(model_pattern);
CREATE INDEX IF NOT EXISTS token_routes_enabled_idx ON token_routes(enabled);

CREATE TABLE IF NOT EXISTS route_channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  route_id INTEGER NOT NULL REFERENCES token_routes(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token_id INTEGER REFERENCES account_tokens(id) ON DELETE SET NULL,
  source_model TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  weight INTEGER NOT NULL DEFAULT 10,
  enabled INTEGER NOT NULL DEFAULT 1,
  manual_override INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  fail_count INTEGER NOT NULL DEFAULT 0,
  total_latency_ms INTEGER NOT NULL DEFAULT 0,
  total_cost REAL NOT NULL DEFAULT 0,
  last_used_at TEXT,
  last_selected_at TEXT,
  last_fail_at TEXT,
  consecutive_fail_count INTEGER NOT NULL DEFAULT 0,
  cooldown_level INTEGER NOT NULL DEFAULT 0,
  cooldown_until TEXT
);
CREATE INDEX IF NOT EXISTS route_channels_route_idx ON route_channels(route_id);
CREATE INDEX IF NOT EXISTS route_channels_account_idx ON route_channels(account_id);
CREATE INDEX IF NOT EXISTS route_channels_token_idx ON route_channels(token_id);
CREATE INDEX IF NOT EXISTS route_channels_route_enabled_idx ON route_channels(route_id, enabled);

CREATE TABLE IF NOT EXISTS route_group_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_route_id INTEGER NOT NULL REFERENCES token_routes(id) ON DELETE CASCADE,
  source_route_id INTEGER NOT NULL REFERENCES token_routes(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  UNIQUE(group_route_id, source_route_id)
);
CREATE INDEX IF NOT EXISTS route_group_sources_group_idx ON route_group_sources(group_route_id);

CREATE TABLE IF NOT EXISTS route_decision_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  route_id INTEGER NOT NULL REFERENCES token_routes(id) ON DELETE CASCADE,
  requested_model TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  refreshed_at TEXT NOT NULL,
  UNIQUE(route_id)
);
CREATE INDEX IF NOT EXISTS route_decision_snapshots_refreshed_idx ON route_decision_snapshots(refreshed_at);

CREATE TABLE IF NOT EXISTS downstream_api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  key TEXT NOT NULL UNIQUE,
  description TEXT,
  group_name TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1,
  expires_at TEXT,
  max_cost REAL,
  used_cost REAL NOT NULL DEFAULT 0,
  max_requests INTEGER,
  used_requests INTEGER NOT NULL DEFAULT 0,
  model_scope TEXT NOT NULL DEFAULT 'selected',
  supported_models TEXT NOT NULL DEFAULT '[]',
  allowed_route_ids TEXT NOT NULL DEFAULT '[]',
  allowed_site_ids TEXT NOT NULL DEFAULT '[]',
  allowed_credential_refs TEXT NOT NULL DEFAULT '[]',
  site_weight_multipliers TEXT NOT NULL DEFAULT '{}',
  excluded_site_ids TEXT NOT NULL DEFAULT '[]',
  excluded_credential_refs TEXT NOT NULL DEFAULT '[]',
  last_used_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS downstream_api_keys_enabled_idx ON downstream_api_keys(enabled);
CREATE INDEX IF NOT EXISTS downstream_api_keys_expires_idx ON downstream_api_keys(expires_at);

CREATE TABLE IF NOT EXISTS proxy_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  route_id INTEGER,
  channel_id INTEGER,
  account_id INTEGER,
  downstream_api_key_id INTEGER,
  model_requested TEXT,
  model_actual TEXT,
  status TEXT NOT NULL,
  http_status INTEGER,
  is_stream INTEGER NOT NULL DEFAULT 0,
  first_byte_latency_ms INTEGER,
  latency_ms INTEGER,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost REAL NOT NULL DEFAULT 0,
  billing_details TEXT,
  debug_trace_id INTEGER,
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS proxy_logs_created_idx ON proxy_logs(created_at);
CREATE INDEX IF NOT EXISTS proxy_logs_status_created_idx ON proxy_logs(status, created_at);
CREATE INDEX IF NOT EXISTS proxy_logs_model_created_idx ON proxy_logs(model_actual, created_at);

CREATE TABLE IF NOT EXISTS proxy_debug_traces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  downstream_path TEXT NOT NULL,
  client_kind TEXT,
  session_id TEXT,
  trace_hint TEXT,
  requested_model TEXT,
  downstream_api_key_id INTEGER,
  request_headers_json TEXT,
  selected_channel_id INTEGER,
  selected_route_id INTEGER,
  selected_account_id INTEGER,
  selected_site_id INTEGER,
  selected_site_platform TEXT,
  decision_summary_json TEXT,
  final_status TEXT,
  final_http_status INTEGER,
  final_upstream_path TEXT,
  final_response_headers_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS proxy_debug_traces_created_idx ON proxy_debug_traces(created_at);
CREATE INDEX IF NOT EXISTS proxy_debug_traces_session_created_idx ON proxy_debug_traces(session_id, created_at);
CREATE INDEX IF NOT EXISTS proxy_debug_traces_model_created_idx ON proxy_debug_traces(requested_model, created_at);
CREATE INDEX IF NOT EXISTS proxy_debug_traces_status_created_idx ON proxy_debug_traces(final_status, created_at);

CREATE TABLE IF NOT EXISTS proxy_debug_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trace_id INTEGER NOT NULL REFERENCES proxy_debug_traces(id) ON DELETE CASCADE,
  attempt_index INTEGER NOT NULL,
  endpoint TEXT NOT NULL,
  request_path TEXT NOT NULL,
  target_url TEXT NOT NULL,
  runtime_executor TEXT,
  request_headers_json TEXT,
  response_status INTEGER,
  response_headers_json TEXT,
  raw_error_text TEXT,
  recover_applied INTEGER NOT NULL DEFAULT 0,
  downgrade_decision INTEGER NOT NULL DEFAULT 0,
  downgrade_reason TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(trace_id, attempt_index)
);
CREATE INDEX IF NOT EXISTS proxy_debug_attempts_trace_created_idx ON proxy_debug_attempts(trace_id, created_at);

CREATE TABLE IF NOT EXISTS proxy_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL,
  owner_type TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  purpose TEXT,
  byte_size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  content_base64 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS proxy_files_public_id_unique ON proxy_files(public_id);
CREATE INDEX IF NOT EXISTS proxy_files_owner_lookup_idx ON proxy_files(owner_type, owner_id, deleted_at);

CREATE TABLE IF NOT EXISTS proxy_video_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL,
  upstream_video_id TEXT NOT NULL,
  site_url TEXT NOT NULL,
  token_ref TEXT NOT NULL,
  requested_model TEXT,
  actual_model TEXT,
  channel_id INTEGER,
  account_id INTEGER,
  status_snapshot TEXT,
  upstream_response_meta TEXT,
  last_upstream_status INTEGER,
  last_polled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS proxy_video_tasks_public_id_unique ON proxy_video_tasks(public_id);
CREATE INDEX IF NOT EXISTS proxy_video_tasks_upstream_video_id_idx ON proxy_video_tasks(upstream_video_id);
CREATE INDEX IF NOT EXISTS proxy_video_tasks_created_at_idx ON proxy_video_tasks(created_at);

CREATE TABLE IF NOT EXISTS site_announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  source_key TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'info',
  source_url TEXT,
  starts_at TEXT,
  ends_at TEXT,
  upstream_created_at TEXT,
  upstream_updated_at TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  read_at TEXT,
  dismissed_at TEXT,
  raw_payload TEXT,
  UNIQUE(site_id, source_key)
);
CREATE INDEX IF NOT EXISTS site_announcements_site_first_seen_idx ON site_announcements(site_id, first_seen_at);
CREATE INDEX IF NOT EXISTS site_announcements_read_idx ON site_announcements(read_at);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT,
  level TEXT NOT NULL DEFAULT 'info',
  read INTEGER NOT NULL DEFAULT 0,
  related_id INTEGER,
  related_type TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_read_created_idx ON events(read, created_at);
CREATE INDEX IF NOT EXISTS events_type_created_idx ON events(type, created_at);
`);

  ensureColumn('proxy_logs', 'debug_trace_id', 'ALTER TABLE proxy_logs ADD COLUMN debug_trace_id INTEGER');
}

function ensureColumn(table: string, column: string, statement: string): void {
  const rows = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!rows.some((row) => row.name === column)) sqlite.exec(statement);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations();
  console.log('Database migration complete');
}
