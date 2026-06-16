import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { buildFastifyOptions, config } from './config.js';
import { runMigrations } from './db/migrate.js';
import { adminAuthMiddleware, proxyAuthMiddleware } from './middleware/auth.js';
import { healthRoutes } from './routes/api/health.js';
import { authRoutes } from './routes/api/auth.js';
import { sitesRoutes } from './routes/api/sites.js';
import { accountsRoutes } from './routes/api/accounts.js';
import { accountTokensRoutes } from './routes/api/accountTokens.js';
import { tokenRoutesRoutes } from './routes/api/routes.js';
import { downstreamKeysRoutes } from './routes/api/downstreamKeys.js';
import { proxyLogsRoutes } from './routes/api/proxyLogs.js';
import { settingsRoutes } from './routes/api/settings.js';
import { eventsRoutes } from './routes/api/events.js';
import { siteAnnouncementsRoutes } from './routes/api/siteAnnouncements.js';
import { statsRoutes } from './routes/api/stats.js';
import { testRoutes } from './routes/api/test.js';
import { taskRoutes } from './routes/api/tasks.js';
import { monitorRoutes } from './routes/api/monitor.js';
import { oauthRoutes } from './routes/api/oauth.js';
import { clientConfigRoutes } from './routes/api/clientConfigs.js';
import { proxyRoutes } from './routes/proxy/router.js';
import { startBalanceRefreshScheduler } from './services/balanceScheduler.js';
import { startBackupWebdavScheduler } from './services/backupWebdavService.js';
import { startProxyLogRetentionScheduler } from './services/proxyLogRetentionService.js';
import { hydrateRuntimeSettings } from './services/settingsService.js';

runMigrations();
hydrateRuntimeSettings();
startBalanceRefreshScheduler();
startProxyLogRetentionScheduler();
startBackupWebdavScheduler();

const app = Fastify(buildFastifyOptions(config));
await app.register(cors, { origin: true });

app.addHook('onRequest', async (request, reply) => {
  if (request.url.startsWith('/api/') && request.url !== '/api/health' && !request.url.startsWith('/api/oauth/callback/')) {
    await adminAuthMiddleware(request, reply);
    if (reply.sent) return;
  }
  if (
    request.url.startsWith('/v1/') ||
    request.url.startsWith('/v1beta/') ||
    request.url.startsWith('/gemini/') ||
    request.url.startsWith('/responses') ||
    request.url.startsWith('/chat/completions')
  ) {
    await proxyAuthMiddleware(request, reply);
    if (reply.sent) return;
  }
});

await app.register(healthRoutes);
await app.register(authRoutes);
await app.register(sitesRoutes);
await app.register(accountsRoutes);
await app.register(accountTokensRoutes);
await app.register(tokenRoutesRoutes);
await app.register(downstreamKeysRoutes);
await app.register(proxyLogsRoutes);
await app.register(settingsRoutes);
await app.register(eventsRoutes);
await app.register(siteAnnouncementsRoutes);
await app.register(statsRoutes);
await app.register(testRoutes);
await app.register(taskRoutes);
await app.register(monitorRoutes);
await app.register(oauthRoutes);
await app.register(clientConfigRoutes);
await app.register(proxyRoutes);

const serverDir = dirname(fileURLToPath(import.meta.url));
const webDist = resolve(serverDir, '../web');
if (existsSync(webDist)) {
  await app.register(fastifyStatic, {
    root: webDist,
    prefix: '/'
  });
}

await app.listen({ host: config.host, port: config.port });

function shouldPrintAdminToken(): boolean {
  return process.env.A2API_PRINT_AUTH_TOKEN === 'true' || process.env.npm_lifecycle_event === 'dev:server';
}

if (shouldPrintAdminToken()) {
  // 仅开发启动打印登录口令，避免生产日志泄漏。
  console.info(`[a2api] 管理 Token: ${config.authToken}`);
}
