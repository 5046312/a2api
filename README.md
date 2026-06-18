# a2api

TypeScript AI API aggregation proxy with Fastify, SQLite, and Vue + Naive UI admin UI.

## Scope

P0 implemented:

- Fastify server and Vite Vue + Naive UI admin UI.
- Vue DevTools Vite plugin is enabled for local frontend debugging.
- Vue Router page routing and Pinia-backed admin session state.
- Fastify serves the built admin UI with history fallback for Vue Router paths.
- SQLite schema and startup migration.
- Admin auth and proxy auth.
- Admin auth failure rate limit with `Retry-After`.
- Unified upstream account management for API endpoint, API Key, platform, models, downstream keys, and proxy logs.
- Upstream account create and edit right-side drawer UI for API endpoint, API Key, platform, authentication mode, account-level proxy, unit cost, status, pinned state, and sort order.
- Upstream account default model-cost drawer with provider groups, editable model costs, USD storage, and RMB display/input conversion.
- Upstream account model drawer for fixed account model lists, per-model cost editing, upstream model preview selection with default cost prefill, and automatic route rebuild after model changes.
- Upstream account batch enable/disable/delete and selected balance refresh from the admin UI.
- Upstream account API Key is stored on the account; legacy key-list rows are only read as old-data fallback and are not used to generate model channels.
- Downstream key policy controls for model scope, upstream account authorization, exclusions, and batch operations.
- Downstream key request and cost usage accounting, with upstream account `unitCost` used for usage-based cost estimates from non-stream JSON usage or stream SSE usage, plus admin usage reset.
- Downstream key list keeps masked values in bulk responses and supports on-demand full-key copy from the key column.
- Upstream account-level proxy configuration stored per upstream account.
- Legacy account key-list compatibility is kept internally for old imports; the admin UI uses upstream accounts only.
- Dedicated platform adapters for OneHub, DoneHub, Veloera, AnyRouter, CliProxyAPI, and Claude model discovery.
- Manual, batch, and scheduled upstream account balance refresh, with failures recorded as events without marking upstream accounts expired.
- Scheduled proxy log cleanup controlled by cron and retention days.
- Proxy log filters by request ID, status, model, upstream account, downstream key, stream flag, and time range, with paginated admin tables and range-based reset.
- Proxy requests insert a `pending` log row as soon as backend routing starts, then update the same row to the final result after upstream completion.
- Proxy logs record upstream usage from non-stream `usage` fields and stream SSE terminal usage; if the upstream does not return usage, token and cost fields remain 0.
- Failure logs show failed channel attempts from debug trace attempts, including requests that later succeeded after failover.
- Proxy log detail view uses the debug trace ID as the admin request ID, and shows request summary, final result, billing, retry, error, selected-channel score percentage, hoverable same-priority-bucket probability snapshot with a pie chart and fixed 12 o'clock hit pointer, and channel attempt fields.
- Proxy debug trace writes an attempt row before each real upstream fetch starts, then updates that same row with the response or failure result, including repeated retries against the same upstream account.
- Runtime settings snapshot and tabbed editing for proxy, allowlist, timeout, retry, default model strategy, route cache TTL, temporary channel-disable rules, balance refresh cron, log cleanup, and system proxy testing.
- Runtime settings compatibility APIs for `/api/settings/runtime`, `/api/settings/brand-list`, and SQLite runtime database status.
- Maintenance APIs for clearing runtime caches and usage data.
- Native upstream account availability monitor with scheduler, heartbeats, uptime windows, manual checks, and notification events.
- Webhook notification settings page and test send endpoint, with empty URL preserving the saved secret and explicit clear support.
- System events and program logs pages with filters, unread count, mark-read, load-more, and clear operations.
- In-memory background task registry and `GET /api/tasks` status APIs for later async operations.
- About page with version, current stack, shipped capabilities, and deferred operations scope.
- OAuth provider discovery, local session start/status/manual callback, callback entry, credential JSON import, local refresh/quota endpoints, and admin page.
- OAuth upstream account list, enable/disable, refresh/quota, import, and delete APIs, surfaced in the admin UI.
- Stats overview API and dashboard cards for today's requests, success rate, tokens, cost, active upstreams, and abnormal upstream accounts.
- Upstream usage, model usage, and model marketplace stats APIs, including minimum and average model costs, surfaced in dashboard and model marketplace pages.
- Model decision explanation for channel candidates, consecutive failures, scores, probabilities, and availability status.
- Model lite and summary APIs for selector and first-screen model data.
- Decision snapshot and group-source APIs remain available for backend compatibility, but are not surfaced in the model admin page.
- Model strategy editing, channel priority / weight / enabled-state auto-save, score penalty reset, and cooldown clearing from the admin UI.
- Admin model tester page backed by `POST /api/test/chat` for non-stream Chat testing through the same proxy routing core, with optional downstream key policy, forced channel selection, model explanation, and debug trace detail.
- JSON backup export/import for upstream accounts, preferences, or all data.
- OpenAI-compatible `/v1/models`.
- OpenAI-compatible `/v1/chat/completions` with non-stream and stream forwarding.
- Root alias `POST /chat/completions` for clients that do not send `/v1`.
- OpenAI Responses `/v1/responses` pass-through with non-stream and stream forwarding.
- Initial `/v1/responses/compact` non-stream support, backed by `/v1/responses` and returned as compact response shape.
- Root Responses aliases `/responses` and `/responses/compact`.
- Initial Claude Messages `/v1/messages` pass-through with Anthropic headers and stream forwarding.
- Initial Claude `/v1/messages/count_tokens` pass-through with token-counting beta and non-stream forwarding.
- Initial OpenAI-compatible `/v1/completions` legacy pass-through with non-stream and stream forwarding.
- Initial OpenAI-compatible `/v1/embeddings` non-stream pass-through.
- Initial OpenAI-compatible Files API with DB-backed multipart upload, list, detail, content, and soft delete.
- Initial OpenAI-compatible `/v1/images/generations` JSON, `/v1/images/edits` multipart, and `/v1/images/variations` multipart non-stream pass-through.
- Initial OpenAI-compatible `/v1/search` non-stream pass-through with `__search` default routing model.
- Initial OpenAI-compatible `/v1/videos` create/poll/delete pass-through with local task ID mapping.
- Initial Gemini-compatible `/v1beta/models`, non-stream `generateContent`, SSE `streamGenerateContent`, and explicit `countTokens` 501 response for OpenAI-compatible upstreams.
- Initial OAuth local session/manual callback/import/refresh/quota support, plus OAuth upstream account connection list, enable/disable, and delete APIs, surfaced in the admin UI.
- WebDAV backup config, manual import/export, and scheduled export.
- External client config snippets for OpenAI-compatible clients, Cherry Studio, Roo/Kilo Code, Claude Code, Codex CLI, Claude Code Router, and CC Switch.
- Maintenance factory reset for clearing runtime business data while preserving environment credentials and database path.
- Native monitor page for upstream account status, heartbeat bars, uptime, manual checks, and monitor settings.
- Automatic model rebuild, channel cooldown, failover, and proxy log writes.
- Docker Compose service mode.

Remaining P2/P3 areas are intentionally not folded into this first implementation: Gemini native `countTokens` compatibility, Search web-search simulation, full provider-native OAuth token exchange, persistent OAuth sessions, rebind flow, provider-specific quota semantics, full route group runtime expansion, multi-database runtime, Tauri desktop shell, and advanced analytics.

## Commands

```bash
pnpm install
pnpm dev:server
pnpm dev:web
```

`pnpm dev` / `pnpm dev:server` starts the server in development mode and prints the current admin `AUTH_TOKEN` in the terminal after the server is listening.

Build:

```bash
pnpm build
pnpm start
```

Format:

```bash
pnpm format
pnpm format:check
```

## Path Aliases

Vite and TypeScript share these aliases:

- `@/*` -> `src/*`
- `@web/*` -> `src/web/*`
- `@pages/*` -> `src/web/pages/*`
- `@styles/*` -> `src/web/styles/*`
- `@server/*` -> `src/server/*`

Frontend cross-directory imports should prefer `@web`, `@pages`, and `@styles`; nearby files can keep relative imports. Server runtime imports still use relative paths unless runtime alias support is added.

## Environment

```env
AUTH_TOKEN=change-me-admin-token
PROXY_TOKEN=change-me-proxy-sk-token
HOST=0.0.0.0
PORT=4000
DATA_DIR=./data
REQUEST_BODY_LIMIT=20971520
SYSTEM_PROXY_URL=
ADMIN_IP_ALLOWLIST=
PROXY_MAX_CHANNEL_ATTEMPTS=3
PROXY_CHANNEL_RETRY_ATTEMPTS=1
DEFAULT_ROUTING_STRATEGY=weighted
PROXY_FIRST_BYTE_TIMEOUT_SEC=0
TOKEN_ROUTER_CACHE_TTL_MS=1500
BALANCE_REFRESH_CRON="0 * * * *"
LOG_CLEANUP_CRON="0 6 * * *"
LOG_CLEANUP_RETENTION_DAYS=30
WEBHOOK_ENABLED=false
WEBHOOK_URL=
NOTIFY_COOLDOWN_SEC=300
```

SQLite defaults to `${DATA_DIR}/a2api.sqlite`.

`AUTH_TOKEN` is the admin UI login token. It can be set in `a2api/.env` or the process environment. If unset, development mode falls back to `change-me-admin-token`; production mode rejects the built-in default.

## First Flow

1. Start server and web UI.
2. Log in with `AUTH_TOKEN`.
3. Open the upstream account page and add an upstream account with API endpoint and API Key.
4. Refresh upstream account models.
5. Rebuild models.
6. If several upstream accounts share the same model, open the model page and use the channel drawer to adjust upstream account priority, weight, or per-model strategy.
7. Create a downstream key with `modelScope = all`.
8. Call `/v1/models` or `/v1/chat/completions` using that key.
