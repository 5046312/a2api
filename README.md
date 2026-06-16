# a2api

TypeScript AI API aggregation proxy with Fastify, SQLite, and Vue admin UI.

## Scope

P0 implemented:

- Fastify server and Vite Vue admin UI.
- SQLite schema and startup migration.
- Admin auth and proxy auth.
- Admin auth failure rate limit with `Retry-After`.
- Sites, accounts, account tokens, routes, downstream keys, proxy logs.
- Site create/edit and list UI exposes pinned and sort order fields.
- Site batch enable/disable/delete and system-proxy toggles.
- Site API endpoint pool management API and admin UI, with Chat proxy endpoint rotation and cooldown.
- Site available model query plus disabled model management API and admin UI, applied during model discovery, route rebuild, and runtime route selection.
- Account create and edit UI for credentials, account-level proxy, unit cost, status, pinned state, and sort order.
- Account batch enable/disable/delete and selected balance refresh from the admin UI.
- Account token create and edit UI for name, group, token replacement, enabled state, and default marker.
- Account token filtering by account, status, and group, plus batch enable/disable.
- Downstream key policy controls for model scope, route/site/account/token authorization, exclusions, site weight multipliers, and batch operations.
- Downstream key request and cost usage accounting, with account `unitCost` used for token-based cost estimates and admin usage reset.
- Account-level proxy configuration stored per account and preferred before site or system proxy.
- Upstream account token sync for OpenAI-compatible New API / One API style token lists, preserving local name, group, enabled state, and default marker.
- Dedicated platform adapters for OneHub, DoneHub, Veloera, AnyRouter, CliProxyAPI, and Claude model discovery.
- Manual, batch, and scheduled account balance refresh, with failures recorded as events without marking accounts expired.
- Scheduled proxy log cleanup controlled by cron and retention days.
- Proxy log filters by status, model, site, account, downstream key, stream flag, and time range.
- Proxy log detail view with routing, cache token, billing, retry, and error fields.
- Proxy debug trace records for Chat proxy attempts, linked from proxy log details and available from the proxy log trace list.
- Runtime settings snapshot and editing for proxy, allowlist, timeout, retry, route cache TTL, balance refresh cron, log cleanup, and system proxy testing.
- Runtime settings compatibility APIs for `/api/settings/runtime`, `/api/settings/brand-list`, and SQLite runtime database status.
- Maintenance APIs for clearing runtime caches and usage data.
- Monitor config and session APIs backing the embedded monitor page.
- Webhook notification settings page and test send endpoint, with empty URL preserving the saved secret and explicit clear support.
- System events and program logs pages with filters, unread count, mark-read, load-more, and clear operations.
- In-memory background task registry and `GET /api/tasks` status APIs for later async operations.
- Initial site announcements storage API with list, read, read-all, dismiss, clear, and JSON backup coverage.
- About page with version, current stack, shipped capabilities, and deferred operations scope.
- OAuth provider discovery, local session start/status/manual callback, callback entry, credential JSON import, local refresh/quota endpoints, and admin page.
- OAuth connection list, enable/disable, refresh/quota, import, and delete APIs, surfaced in the admin UI.
- Stats overview API and dashboard cards for today's requests, success rate, tokens, cost, active sites, and abnormal accounts.
- Site usage, model usage, and model marketplace stats APIs, surfaced in dashboard and model marketplace pages.
- Route decision explanation for channel candidates, scores, probabilities, and filter reasons.
- Route lite and summary APIs for selector and first-screen route data.
- Route decision snapshots and group-source maintenance APIs, surfaced in the route admin page.
- Route enable/disable and cooldown clearing from the admin UI.
- Admin model tester page backed by `POST /api/test/chat` for non-stream Chat testing through the same proxy routing core, with optional downstream key policy, forced channel selection, route explanation, and debug trace detail.
- JSON backup export/import for accounts, preferences, or all data.
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
- Initial OAuth local session/manual callback/import/refresh/quota support, plus OAuth account connection list, enable/disable, and delete APIs, surfaced in the admin UI.
- WebDAV backup config, manual import/export, and scheduled export.
- External client config snippets for OpenAI-compatible clients, Cherry Studio, Roo/Kilo Code, Claude Code, Codex CLI, Claude Code Router, and CC Switch.
- Maintenance factory reset for clearing runtime business data while preserving environment credentials and database path.
- Monitor embed page with LDOH Cookie config, session init, and same-origin LDOH proxy.
- Route rebuild, channel cooldown, failover, and proxy log writes.
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
3. Add an OpenAI-compatible site.
4. Add an API key account.
5. Refresh account models.
6. Rebuild routes.
7. Create a downstream key with `modelScope = all`.
8. Call `/v1/models` or `/v1/chat/completions` using that key.
