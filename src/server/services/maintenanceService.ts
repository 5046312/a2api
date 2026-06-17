import { db, schema, sqlite } from '../db/index.js';
import { buildConfig, config } from '../config.js';
import { nowIso } from '../shared/time.js';
import { updateBalanceRefreshCron } from './balanceScheduler.js';
import { startBackupWebdavScheduler, stopBackupWebdavScheduler } from './backupWebdavService.js';
import { updateProxyLogRetentionSchedule } from './proxyLogRetentionService.js';
import { clearTokenRouterCache } from './tokenRouter.js';

export type ClearRuntimeCacheResult = {
  ok: true;
  message: string;
  deletedModelAvailability: number;
  deletedTokenModelAvailability: number;
  deletedRouteChannels: number;
  deletedTokenRoutes: number;
};

export type ClearUsageDataResult = {
  ok: true;
  message: string;
  deletedProxyLogs: number;
  deletedProxyDebugTraces: number;
  deletedProxyDebugAttempts: number;
  deletedMonitorHeartbeats: number;
  resetRouteChannels: number;
  resetAccounts: number;
  resetDownstreamKeys: number;
};

export type FactoryResetResult = {
  ok: true;
  success: true;
  message: string;
  deleted: {
    siteApiEndpoints: number;
    siteDisabledModels: number;
    sites: number;
    accounts: number;
    accountTokens: number;
    modelAvailability: number;
    tokenModelAvailability: number;
    tokenRoutes: number;
    routeChannels: number;
    downstreamKeys: number;
    proxyLogs: number;
    proxyDebugTraces: number;
    proxyDebugAttempts: number;
    proxyFiles: number;
    proxyVideoTasks: number;
    accountMonitors: number;
    monitorHeartbeats: number;
    siteAnnouncements: number;
    settings: number;
    events: number;
  };
};

function recordMaintenanceEvent(title: string, message: string): void {
  try {
    db.insert(schema.events)
      .values({
        type: 'maintenance',
        title,
        message,
        level: 'warning',
        relatedType: 'settings',
        createdAt: nowIso()
      })
      .run();
  } catch {
    // 维护接口不因事件记录失败而中断主操作。
  }
}

function resetRuntimeConfig(): void {
  const baseline = buildConfig(process.env);
  Object.assign(config, baseline);
  updateBalanceRefreshCron(config.balanceRefreshCron);
  updateProxyLogRetentionSchedule({
    cron: config.logCleanupCron,
    retentionDays: config.logCleanupRetentionDays
  });
  stopBackupWebdavScheduler();
  startBackupWebdavScheduler();
  clearTokenRouterCache();
}

export function clearRuntimeCache(): ClearRuntimeCacheResult {
  const deletedTokenModelAvailability = db.delete(schema.tokenModelAvailability).run().changes;
  const deletedModelAvailability = db.delete(schema.modelAvailability).run().changes;
  const deletedRouteChannels = db.delete(schema.routeChannels).run().changes;
  const deletedTokenRoutes = db.delete(schema.tokenRoutes).run().changes;
  clearTokenRouterCache();

  const message = '缓存已清理，请重新刷新模型或重建路由';
  recordMaintenanceEvent(
    '缓存已清理',
    `已清理模型可用性 ${deletedModelAvailability} 条、Token 模型可用性 ${deletedTokenModelAvailability} 条、路由 ${deletedTokenRoutes} 条、通道 ${deletedRouteChannels} 条`
  );

  return {
    ok: true,
    message,
    deletedModelAvailability,
    deletedTokenModelAvailability,
    deletedRouteChannels,
    deletedTokenRoutes
  };
}

export function clearUsageData(): ClearUsageDataResult {
  const deletedProxyLogs = db.delete(schema.proxyLogs).run().changes;
  const deletedProxyDebugAttempts = db.delete(schema.proxyDebugAttempts).run().changes;
  const deletedProxyDebugTraces = db.delete(schema.proxyDebugTraces).run().changes;
  const deletedMonitorHeartbeats = db.delete(schema.monitorHeartbeats).run().changes;
  const resetRouteChannels = db
    .update(schema.routeChannels)
    .set({
      successCount: 0,
      failCount: 0,
      totalLatencyMs: 0,
      totalCost: 0,
      lastUsedAt: null,
      lastSelectedAt: null,
      lastFailAt: null,
      consecutiveFailCount: 0,
      cooldownLevel: 0,
      cooldownUntil: null
    })
    .run().changes;
  const resetAccounts = db.update(schema.accounts).set({ balanceUsed: 0, updatedAt: nowIso() }).run().changes;
  const resetDownstreamKeys = db
    .update(schema.downstreamApiKeys)
    .set({ usedCost: 0, usedRequests: 0, lastUsedAt: null, updatedAt: nowIso() })
    .run().changes;
  clearTokenRouterCache();

  const message = '使用统计已清理';
  recordMaintenanceEvent(
    '使用统计已清理',
    `已清理代理日志 ${deletedProxyLogs} 条、debug trace ${deletedProxyDebugTraces} 条、debug attempt ${deletedProxyDebugAttempts} 条，并重置路由、账号和下游 Key 用量`
  );

  return {
    ok: true,
    message,
    deletedProxyLogs,
    deletedProxyDebugTraces,
    deletedProxyDebugAttempts,
    deletedMonitorHeartbeats,
    resetRouteChannels,
    resetAccounts,
    resetDownstreamKeys
  };
}

export function factoryReset(): FactoryResetResult {
  const deleted = sqlite.transaction(() => {
    const proxyDebugAttempts = db.delete(schema.proxyDebugAttempts).run().changes;
    const proxyLogs = db.delete(schema.proxyLogs).run().changes;
    const proxyDebugTraces = db.delete(schema.proxyDebugTraces).run().changes;
    const routeChannels = db.delete(schema.routeChannels).run().changes;
    const tokenModelAvailability = db.delete(schema.tokenModelAvailability).run().changes;
    const modelAvailability = db.delete(schema.modelAvailability).run().changes;
    const monitorHeartbeats = db.delete(schema.monitorHeartbeats).run().changes;
    const accountMonitors = db.delete(schema.accountMonitors).run().changes;
    const accountTokens = db.delete(schema.accountTokens).run().changes;
    const accounts = db.delete(schema.accounts).run().changes;
    const tokenRoutes = db.delete(schema.tokenRoutes).run().changes;
    const siteAnnouncements = db.delete(schema.siteAnnouncements).run().changes;
    const siteDisabledModels = db.delete(schema.siteDisabledModels).run().changes;
    const siteApiEndpoints = db.delete(schema.siteApiEndpoints).run().changes;
    const sites = db.delete(schema.sites).run().changes;
    const downstreamKeys = db.delete(schema.downstreamApiKeys).run().changes;
    const proxyFiles = db.delete(schema.proxyFiles).run().changes;
    const proxyVideoTasks = db.delete(schema.proxyVideoTasks).run().changes;
    const settings = db.delete(schema.settings).run().changes;
    const events = db.delete(schema.events).run().changes;
    return {
      siteApiEndpoints,
      siteDisabledModels,
      sites,
      accounts,
      accountTokens,
      modelAvailability,
      tokenModelAvailability,
      tokenRoutes,
      routeChannels,
      downstreamKeys,
      proxyLogs,
      proxyDebugTraces,
      proxyDebugAttempts,
      proxyFiles,
      proxyVideoTasks,
      accountMonitors,
      monitorHeartbeats,
      siteAnnouncements,
      settings,
      events
    };
  })();

  resetRuntimeConfig();
  const message = '系统已重新初始化';
  recordMaintenanceEvent('系统已重新初始化', '业务数据、运行设置和 WebDAV 自动任务已清理，管理 Token 和数据库路径保留当前环境配置');
  return {
    ok: true,
    success: true,
    message,
    deleted
  };
}
