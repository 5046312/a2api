<p align="center">
  <img src="./docs/icon.svg" width="120" height="120" alt="a2api icon">
</p>

<h1 align="center">a2api</h1>

<p align="center">
  Self-hosted AI API aggregation proxy with model routing, admin operations, and OpenAI / Claude / Gemini compatible endpoints.
</p>

<p align="center">
  <a href="./README.zh-CN.md">简体中文</a> |
  <a href="./README.md">English</a>
</p>

## What is a2api?

a2api lets you place multiple upstream AI accounts behind one local service. It provides a Fastify proxy, a SQLite-backed control plane, and a Vue + Naive UI admin console for operating upstream accounts, downstream keys, model routing, logs, monitoring, settings, OAuth imports, and backups.

The project is built for private deployment and local operations. It focuses on deterministic routing and observable failover instead of automatic sign-in or check-in workflows.

## Highlights

- One downstream endpoint for multiple upstream accounts and platforms.
- Model-oriented routing with account -> model -> channel management.
- OpenAI-compatible `/v1/models`, `/v1/chat/completions`, `/v1/responses`, `/v1/completions`, `/v1/embeddings`, Files, Images, Search, and Videos pass-through surfaces.
- Claude Messages-compatible `/v1/messages` and `/v1/messages/count_tokens` pass-through.
- Gemini-compatible `/v1beta/models` and `generateContent` / `streamGenerateContent` pass-through.
- `weighted`, `stable_first`, and `round_robin` route strategies with channel priority, weights, cooldowns, retry attempts, and decision explanations.
- Admin UI for upstream accounts, downstream keys, model channels, model testing, proxy logs, events, notifications, monitor status, OAuth connections, settings, and import/export.
- Usage and cost accounting from non-stream JSON usage and stream SSE terminal usage.
- Proxy debug traces with per-attempt records, probability snapshots, selected-channel details, and failure evidence.
- SQLite startup migration, Docker Compose service mode, and a Tauri v2 desktop shell with a local Fastify sidecar.

## Stack

- Runtime: Node.js >= 22
- Backend: TypeScript strict, Fastify, Drizzle ORM, SQLite, Zod
- Frontend: Vite, Vue 3, Vue Router, Pinia, Naive UI, TailwindCSS, SCSS
- Desktop: Tauri v2 sidecar mode
- Packaging: Docker Compose and pnpm scripts

## Quick Start

```bash
cd a2api
pnpm install
cp .env.example .env
pnpm dev
```

Development URLs:

- Admin UI: `http://127.0.0.1:5173`
- API server: `http://127.0.0.1:4000`

`pnpm dev` starts the Fastify server and the Vite admin UI. In development, the server prints the current admin `AUTH_TOKEN` after it starts.

## First Setup

1. Log in to the admin UI with `AUTH_TOKEN`.
2. Add an upstream account with API endpoint, API key, platform, proxy, status, and model settings.
3. Refresh or preview upstream models, then save the fixed model list you want exposed.
4. Open the model page to adjust channel priority, weight, enabled state, strategy, and cooldowns.
5. Create a downstream key.
6. Point your client to the a2api base URL and use the downstream key as a bearer token.

Example:

```bash
curl http://127.0.0.1:4000/v1/models \
  -H "Authorization: Bearer $DOWNSTREAM_KEY"
```

## Scripts

```bash
pnpm dev              # server + web UI
pnpm dev:server       # Fastify server only
pnpm dev:web          # Vite admin UI only
pnpm build            # web + server build
pnpm start            # run dist/server
pnpm typecheck        # TypeScript check
pnpm test             # Vitest
pnpm format           # Prettier write
pnpm format:check     # Prettier check
pnpm db:migrate       # run SQLite migrations
```

Desktop:

```bash
pnpm build
pnpm tauri:prepare
pnpm tauri:dev
pnpm tauri:build
```

Docker:

```bash
AUTH_TOKEN=your-admin-token PROXY_TOKEN=your-proxy-token docker compose up -d --build
```

## Environment

Copy `.env.example` to `.env` for local development.

| Variable | Default | Purpose |
| --- | --- | --- |
| `AUTH_TOKEN` | `change-me-admin-token` | Admin UI and admin API token. Must be changed in production. |
| `PROXY_TOKEN` | `change-me-proxy-sk-token` | Default proxy bearer token. Must be changed in production. |
| `HOST` | `0.0.0.0` | Fastify listen host. |
| `PORT` | `4000` | Fastify listen port. |
| `DATA_DIR` | `./data` | Runtime data directory. |
| `DB_URL` | `${DATA_DIR}/a2api.sqlite` | Optional SQLite database path override. |
| `REQUEST_BODY_LIMIT` | `20971520` | Fastify request body limit in bytes. |
| `SYSTEM_PROXY_URL` | empty | Optional outbound system proxy. |
| `ADMIN_IP_ALLOWLIST` | empty | Optional comma-separated admin IP allowlist. |
| `PROXY_MAX_CHANNEL_ATTEMPTS` | `3` | Maximum channels tried per proxy request. |
| `PROXY_CHANNEL_RETRY_ATTEMPTS` | `1` | Retry attempts per selected channel. |
| `DEFAULT_ROUTING_STRATEGY` | `weighted` | New automatic model route strategy: `weighted`, `stable_first`, or `round_robin`. |
| `PROXY_FIRST_BYTE_TIMEOUT_SEC` | `0` | Optional upstream first-byte timeout. |
| `TOKEN_ROUTER_CACHE_TTL_MS` | `1500` | Token router cache TTL. |
| `BALANCE_REFRESH_CRON` | `0 * * * *` | Balance refresh schedule. |
| `LOG_CLEANUP_CRON` | `0 6 * * *` | Log cleanup schedule. |
| `LOG_CLEANUP_RETENTION_DAYS` | `30` | Log retention days. |
| `WEBHOOK_ENABLED` | `false` | Enable webhook notifications. |
| `WEBHOOK_URL` | empty | Webhook notification URL. |
| `NOTIFY_COOLDOWN_SEC` | `300` | Notification cooldown. |

## Client Base URLs

After build, Fastify serves the admin UI and proxy endpoints from one origin:

- OpenAI-compatible clients: `http://127.0.0.1:4000/v1`
- Claude Messages-compatible clients: `http://127.0.0.1:4000/v1`
- Gemini-compatible clients: `http://127.0.0.1:4000/v1beta`
- Root aliases: `/chat/completions`, `/responses`, `/responses/compact`

Use a downstream key created in the admin UI for normal clients. `PROXY_TOKEN` is the initial server-level proxy token.

## Admin Areas

- Dashboard: requests, success rate, tokens, cost, active upstreams, and abnormal upstream accounts.
- Upstream accounts: endpoint, key, platform, authentication mode, proxy, cost, status, model list, balance refresh, and batch operations.
- Models: exposed models, route strategy, channel priority, weights, cooldowns, score reset, and decision details.
- Model tester: non-stream chat tests through the same routing core, with optional downstream policy and forced channel.
- Logs: request filters, final result, billing, retry details, failed attempts, selected-channel score, and probability explanation.
- Monitor: native upstream account checks, heartbeat bars, uptime windows, manual checks, and settings.
- Settings: runtime proxy, retry, timeout, allowlist, route cache, temporary-disable rules, cost display digits, log cleanup, backup, and maintenance actions.

## Repository Layout

```text
src/server/       Fastify server, routes, services, adapters, SQLite schema
src/web/          Vue admin UI, pages, router, stores, styles
src-tauri/        Tauri desktop shell and sidecar configuration
docker/           Docker image definition
scripts/          Packaging helpers
docs/             README assets
```

## Current Scope

The current implementation covers the main self-hosted proxy and admin workflows. Deferred areas include Gemini native `countTokens`, Search web-search simulation, full provider-native OAuth token exchange, persistent OAuth sessions, provider-specific quota semantics, full route group runtime expansion, multi-database runtime, desktop auto-update, signing/notarization, cross-platform release CI, and advanced analytics.
