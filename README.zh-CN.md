<p align="center">
  <img src="./docs/icon.svg" width="120" height="120" alt="a2api 图标">
</p>

<h1 align="center">a2api</h1>

<p align="center">
  自托管 AI API 聚合代理，提供模型路由、管理后台，以及 OpenAI / Claude / Gemini 兼容接口。
</p>

<p align="center">
  <a href="./README.md">English</a> |
  <a href="./README.zh-CN.md">简体中文</a>
</p>

## a2api 是什么？

a2api 可以把多个上游 AI 账号收口到一个本地服务后面。它包含 Fastify 代理、SQLite 控制面，以及 Vue + Naive UI 管理后台，用于管理上游账号、下游密钥、模型路由、日志、监控、设置、OAuth 导入和备份。

项目面向私有部署和本地运维，重点是确定性的路由、可观察的失败切换和清晰的管理流程，不包含自动签到 / 自动 check-in 能力。

## 亮点

- 一个下游入口接入多个上游账号和平台。
- 以模型为核心的 account -> model -> channel 管理链路。
- OpenAI 兼容 `/v1/models`、`/v1/chat/completions`、`/v1/responses`、`/v1/completions`、`/v1/embeddings`、Files、Images、Search、Videos 等接口。
- Claude Messages 兼容 `/v1/messages` 与 `/v1/messages/count_tokens` 转发。
- Gemini 兼容 `/v1beta/models`、`generateContent`、`streamGenerateContent` 转发。
- 支持 `weighted`、`stable_first`、`round_robin` 路由策略，以及通道优先级、权重、冷却、重试次数和决策解释。
- 管理后台覆盖上游账号、下游密钥、模型通道、模型测试、代理日志、事件、通知、监控、OAuth、设置和导入导出。
- 从非流式 JSON usage 和流式 SSE 末尾 usage 中统计用量与成本。
- 代理调试 trace 记录每次通道尝试、概率快照、选中通道和失败证据。
- 支持 SQLite 启动迁移、Docker Compose 服务模式，以及带本地 Fastify sidecar 的 Tauri v2 桌面壳。

## 技术栈

- 运行时：Node.js >= 22
- 后端：TypeScript strict、Fastify、Drizzle ORM、SQLite、Zod
- 前端：Vite、Vue 3、Vue Router、Pinia、Naive UI、TailwindCSS、SCSS
- 桌面端：Tauri v2 sidecar 模式
- 打包：Docker Compose 与 pnpm scripts

## 快速开始

```bash
cd a2api
pnpm install
cp .env.example .env
pnpm dev
```

开发地址：

- 管理后台：`http://127.0.0.1:5173`
- API 服务：`http://127.0.0.1:4000`

`pnpm dev` 会同时启动 Fastify 服务和 Vite 管理后台。开发模式下，服务启动后会在终端打印当前管理端 `AUTH_TOKEN`。

## 首次配置流程

1. 用 `AUTH_TOKEN` 登录管理后台。
2. 新增上游账号，填写 API endpoint、API key、平台、代理、状态和模型配置。
3. 刷新或预览上游模型，然后保存需要暴露的固定模型列表。
4. 打开模型页面，调整通道优先级、权重、启用状态、策略和冷却状态。
5. 创建下游密钥。
6. 将客户端 base URL 指向 a2api，并使用下游密钥作为 bearer token。

示例：

```bash
curl http://127.0.0.1:4000/v1/models \
  -H "Authorization: Bearer $DOWNSTREAM_KEY"
```

## 脚本

```bash
pnpm dev              # 服务端 + 管理后台
pnpm dev:server       # 仅 Fastify 服务
pnpm dev:web          # 仅 Vite 管理后台
pnpm build            # 构建前端和服务端
pnpm start            # 运行 dist/server
pnpm typecheck        # TypeScript 检查
pnpm test             # Vitest
pnpm format           # Prettier 写入
pnpm format:check     # Prettier 检查
pnpm db:migrate       # 执行 SQLite 迁移
```

桌面端：

```bash
pnpm build
pnpm tauri:prepare
pnpm tauri:dev
pnpm tauri:build
```

Docker：

```bash
AUTH_TOKEN=your-admin-token PROXY_TOKEN=your-proxy-token docker compose up -d --build
```

## 环境变量

本地开发可复制 `.env.example` 为 `.env`。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `AUTH_TOKEN` | `change-me-admin-token` | 管理后台和管理 API Token。生产环境必须修改。 |
| `PROXY_TOKEN` | `change-me-proxy-sk-token` | 初始代理 bearer token。生产环境必须修改。 |
| `HOST` | `0.0.0.0` | Fastify 监听地址。 |
| `PORT` | `4000` | Fastify 监听端口。 |
| `DATA_DIR` | `./data` | 运行时数据目录。 |
| `DB_URL` | `${DATA_DIR}/a2api.sqlite` | 可选 SQLite 数据库路径覆盖。 |
| `REQUEST_BODY_LIMIT` | `20971520` | Fastify 请求体大小限制，单位字节。 |
| `SYSTEM_PROXY_URL` | 空 | 可选出站系统代理。 |
| `ADMIN_IP_ALLOWLIST` | 空 | 可选管理端 IP 白名单，逗号分隔。 |
| `PROXY_MAX_CHANNEL_ATTEMPTS` | `3` | 单次代理请求最多尝试的通道数。 |
| `PROXY_CHANNEL_RETRY_ATTEMPTS` | `1` | 单个选中通道的重试次数。 |
| `DEFAULT_ROUTING_STRATEGY` | `weighted` | 新自动模型的默认路由策略：`weighted`、`stable_first`、`round_robin`。 |
| `PROXY_FIRST_BYTE_TIMEOUT_SEC` | `0` | 可选上游首字节超时。 |
| `TOKEN_ROUTER_CACHE_TTL_MS` | `1500` | Token router 缓存 TTL。 |
| `BALANCE_REFRESH_CRON` | `0 * * * *` | 余额刷新计划。 |
| `LOG_CLEANUP_CRON` | `0 6 * * *` | 日志清理计划。 |
| `LOG_CLEANUP_RETENTION_DAYS` | `30` | 日志保留天数。 |
| `WEBHOOK_ENABLED` | `false` | 是否启用 Webhook 通知。 |
| `WEBHOOK_URL` | 空 | Webhook 通知地址。 |
| `NOTIFY_COOLDOWN_SEC` | `300` | 通知冷却时间。 |

## 客户端接入地址

构建后，Fastify 会从同一 origin 提供管理后台和代理接口：

- OpenAI 兼容客户端：`http://127.0.0.1:4000/v1`
- Claude Messages 兼容客户端：`http://127.0.0.1:4000/v1`
- Gemini 兼容客户端：`http://127.0.0.1:4000/v1beta`
- 根路径别名：`/chat/completions`、`/responses`、`/responses/compact`

普通客户端建议使用管理后台创建的下游密钥。`PROXY_TOKEN` 是初始服务级代理 token。

## 管理后台模块

- 仪表盘：请求数、成功率、tokens、成本、活跃上游和异常上游。
- 上游账号：endpoint、key、平台、认证模式、代理、成本、状态、模型列表、余额刷新和批量操作。
- 模型：暴露模型、路由策略、通道优先级、权重、冷却、分数重置和决策详情。
- 操练场：通过同一套路由核心做非流式 chat 测试，支持下游策略和强制通道。
- 日志：请求筛选、最终结果、计费、重试详情、失败尝试、选中通道得分和概率解释。
- 监控：上游账号检查、心跳条、可用率窗口、手动检查和监控设置。
- 设置：运行时代理、重试、超时、白名单、路由缓存、临时禁用规则、日志清理、备份和维护操作。

## 目录结构

```text
src/server/       Fastify 服务端、路由、服务、适配器、SQLite schema
src/web/          Vue 管理后台、页面、路由、store、样式
src-tauri/        Tauri 桌面壳与 sidecar 配置
docker/           Docker 镜像定义
scripts/          打包辅助脚本
docs/             README 资产
```

## 当前范围

当前实现覆盖主要自托管代理和管理后台流程。后续暂未纳入的范围包括 Gemini 原生 `countTokens`、Search web-search 模拟、完整 provider-native OAuth token exchange、持久化 OAuth session、平台特定 quota 语义、完整路由组运行时扩展、多数据库运行时、桌面端自动更新、签名 / notarization、跨平台 release CI 和高级分析。
