import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';

let closeDb: (() => void) | null = null;

async function loadRuntime() {
  if (closeDb) {
    closeDb();
    closeDb = null;
  }
  vi.resetModules();
  process.env.DB_URL = join(tmpdir(), `a2api-${randomUUID()}.sqlite`);
  process.env.AUTH_TOKEN = 'test-admin-token';
  process.env.PROXY_TOKEN = 'test-proxy-token';
  process.env.WEBHOOK_URL = 'https://example.com/webhook-secret-token';
  const dbModule = await import('../db/index.js');
  const migrateModule = await import('../db/migrate.js');
  migrateModule.runMigrations();
  closeDb = () => dbModule.sqlite.close();
  return dbModule;
}

afterEach(() => {
  if (closeDb) {
    closeDb();
    closeDb = null;
  }
  vi.resetModules();
});

describe.sequential('migration gap plan coverage', () => {
  test('保留已保存 Webhook URL，空输入不覆盖脱敏密钥', async () => {
    await loadRuntime();
    const settings = await import('./settingsService.js');
    settings.hydrateRuntimeSettings();

    const snapshot = settings.getSettings();
    expect(snapshot.notificationWebhookUrl).toBe('');
    expect(snapshot.notificationWebhookUrlMasked).toContain('***');

    const updated = settings.updateNotificationSettings({ webhookEnabled: true, webhookUrl: '' });
    expect(updated.webhookEnabled).toBe(true);
    expect(updated.webhookUrlMasked).toBe(snapshot.notificationWebhookUrlMasked);
  });

  test('运行设置可单独更新日志保留天数', async () => {
    await loadRuntime();
    const settings = await import('./settingsService.js');
    settings.hydrateRuntimeSettings();

    const updated = settings.updateSettings({ logCleanupRetentionDays: 12 });

    expect(updated.logCleanupRetentionDays).toBe(12);
    expect(updated.logCleanupCron).toBeTruthy();
  });

  test('新增平台 adapter 可识别关键平台域名', async () => {
    const { detectPlatform } = await import('../adapters/index.js');
    await expect(detectPlatform('https://one-hub.example.com')).resolves.toMatchObject({ platform: 'one-hub' });
    await expect(detectPlatform('https://donehub.example.com')).resolves.toMatchObject({ platform: 'done-hub' });
    await expect(detectPlatform('https://anyrouter.top')).resolves.toMatchObject({ platform: 'anyrouter' });
    await expect(detectPlatform('https://api.anthropic.com')).resolves.toMatchObject({ platform: 'claude' });
  });

  test('OAuth session 可通过 manual callback 导入连接', async () => {
    await loadRuntime();
    const oauth = await import('./oauthSessionService.js');
    const connections = await import('./oauthConnectionService.js');

    const session = oauth.startOAuthSession({ provider: 'codex' });
    const completed = await oauth.completeOAuthSessionFromCallback(
      session.state,
      `https://localhost/callback?access_token=oauth-token&email=user@example.com&account_key=user-1`
    );

    expect(completed?.status).toBe('success');
    const list = await connections.listOAuthConnections();
    expect(list.total).toBe(1);
    expect(list.items[0]?.provider).toBe('codex');
  });

  test('路由决策快照可生成并保存', async () => {
    const { db, schema } = await loadRuntime();
    const { nowIso } = await import('../shared/time.js');
    const { refreshRouteDecisionSnapshot, getRouteDecisionSnapshot } = await import('./routeDecisionSnapshotService.js');
    const now = nowIso();
    const site = db.insert(schema.sites).values({
      name: 'OpenAI',
      url: 'https://api.openai.com',
      platform: 'openai',
      status: 'active',
      createdAt: now,
      updatedAt: now
    }).returning().get();
    const account = db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'test',
      credentialMode: 'apikey',
      apiToken: 'sk-test',
      status: 'active',
      createdAt: now,
      updatedAt: now
    }).returning().get();
    const route = db.insert(schema.tokenRoutes).values({
      modelPattern: 'gpt-test',
      displayName: 'gpt-test',
      routeMode: 'exact',
      routingStrategy: 'weighted',
      enabled: true,
      createdAt: now,
      updatedAt: now
    }).returning().get();
    db.insert(schema.routeChannels).values({
      routeId: route.id,
      accountId: account.id,
      sourceModel: 'gpt-test',
      enabled: true
    }).run();

    const snapshot = await refreshRouteDecisionSnapshot(route.id, 'gpt-test');
    expect(snapshot?.snapshot.matched).toBe(true);
    const saved = await getRouteDecisionSnapshot(route.id);
    expect(saved?.requestedModel).toBe('gpt-test');
  });

  test('账号监控可同步账号并记录手动检查心跳', async () => {
    const { db, schema } = await loadRuntime();
    vi.doMock('../adapters/index.js', () => ({
      getAdapter: () => ({
        getModels: vi.fn(async () => [{ name: 'gpt-monitor-test' }])
      })
    }));
    const { nowIso } = await import('../shared/time.js');
    const monitor = await import('./accountMonitorService.js');
    const now = nowIso();
    const site = db.insert(schema.sites).values({
      name: 'Monitor OpenAI',
      url: 'https://api.openai.com',
      platform: 'openai',
      status: 'active',
      createdAt: now,
      updatedAt: now
    }).returning().get();
    const account = db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'monitor-account',
      credentialMode: 'apikey',
      apiToken: 'sk-monitor',
      status: 'active',
      createdAt: now,
      updatedAt: now
    }).returning().get();

    const settings = monitor.updateMonitorSettings({ intervalSec: 60, timeoutSec: 5, maxRetries: 0, concurrency: 1 });
    expect(settings.intervalSec).toBe(60);

    const synced = await monitor.syncAccountMonitors();
    expect(synced.created).toBe(1);

    const checked = await monitor.checkMonitorAccount(account.id);
    expect(checked.status).toBe('up');

    const detail = await monitor.getMonitorAccount(account.id);
    expect(detail?.status).toBe('up');
    expect(detail?.heartbeats).toHaveLength(1);
    expect(detail?.heartbeats[0]?.modelCount).toBe(1);
  });
});
