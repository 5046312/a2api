import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  settingsPayloadSchema,
  getBrandList,
  getNotificationSettings,
  getRuntimeDatabaseState,
  getSettings,
  testSystemProxy,
  updateNotificationSettings,
  updateSettings
} from '../../services/settingsService.js';
import { backupTypeSchema, exportBackup, importBackup } from '../../services/backupService.js';
import {
  backupWebdavConfigPayloadSchema,
  backupWebdavExportPayloadSchema,
  exportBackupToWebdav,
  getBackupWebdavConfig,
  importBackupFromWebdav,
  saveBackupWebdavConfig
} from '../../services/backupWebdavService.js';
import { clearRuntimeCache, clearUsageData, factoryReset } from '../../services/maintenanceService.js';
import { sendTestNotification } from '../../services/notificationService.js';
import { sendError } from '../../shared/errors.js';

const notificationPayloadSchema = z.object({
  webhookEnabled: z.boolean().optional(),
  webhookUrl: z.string().trim().optional(),
  clearWebhookUrl: z.boolean().optional(),
  notifyCooldownSec: z.number().int().min(0).optional()
});
const backupImportPayloadSchema = z.object({
  backup: z.unknown(),
  type: backupTypeSchema.optional()
});
const systemProxyTestPayloadSchema = z.object({
  proxyUrl: z.string().trim().optional()
});

function handleSettingsUpdate(body: unknown, reply: FastifyReply) {
  const parsed = settingsPayloadSchema.safeParse(body);
  if (!parsed.success) return sendError(reply, 400, 'validation_error', parsed.error.message, 'invalid_payload');
  try {
    return updateSettings(parsed.data);
  } catch (err) {
    return sendError(reply, 400, 'validation_error', err instanceof Error ? err.message : 'Invalid settings', 'invalid_payload');
  }
}

async function handleSystemProxyTest(request: FastifyRequest, reply: FastifyReply) {
  const parsed = systemProxyTestPayloadSchema.safeParse(request.body ?? {});
  if (!parsed.success) return sendError(reply, 400, 'validation_error', parsed.error.message, 'invalid_payload');
  try {
    return await testSystemProxy(parsed.data);
  } catch (err) {
    const message = err instanceof Error ? err.message : '系统代理测试失败';
    if (message === '请先填写系统代理地址' || message === '系统代理地址格式无效') {
      return sendError(reply, 400, 'validation_error', message, 'invalid_payload');
    }
    return sendError(reply, 502, 'upstream_error', message, 'proxy_test_failed');
  }
}

async function handleNotificationTest(reply: FastifyReply) {
  try {
    const result = await sendTestNotification();
    return { ok: true, success: true, message: `测试通知已发送（成功 ${result.succeeded}/${result.attempted}）` };
  } catch (err) {
    return sendError(reply, 400, 'validation_error', err instanceof Error ? err.message : '测试通知发送失败', 'notification_test_failed');
  }
}

function sendBackupWebdavError(reply: FastifyReply, err: unknown, fallback: string, code: string) {
  const message = err instanceof Error ? err.message : fallback;
  return sendError(reply, message.includes('HTTP 409') ? 409 : 400, 'validation_error', message, code);
}

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/settings', async () => getSettings());

  app.get('/api/settings/runtime', async () => getSettings());

  app.get('/api/settings/brand-list', async () => getBrandList());

  app.get('/api/settings/database/runtime', async () => getRuntimeDatabaseState());

  app.put('/api/settings', async (request, reply) => handleSettingsUpdate(request.body, reply));

  app.put('/api/settings/runtime', async (request, reply) => handleSettingsUpdate(request.body, reply));

  app.post('/api/settings/test-proxy', handleSystemProxyTest);

  app.post('/api/settings/system-proxy/test', handleSystemProxyTest);

  app.get('/api/settings/notifications', async () => getNotificationSettings());

  app.put('/api/settings/notifications', async (request, reply) => {
    const parsed = notificationPayloadSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'validation_error', parsed.error.message, 'invalid_payload');
    try {
      return updateNotificationSettings(parsed.data);
    } catch (err) {
      return sendError(reply, 400, 'validation_error', err instanceof Error ? err.message : 'Invalid notification settings', 'invalid_payload');
    }
  });

  app.post('/api/settings/notifications/test', async (_, reply) => handleNotificationTest(reply));

  app.post('/api/settings/notify/test', async (_, reply) => handleNotificationTest(reply));

  app.post('/api/settings/maintenance/clear-cache', async () => clearRuntimeCache());

  app.post('/api/settings/maintenance/clear-usage', async () => clearUsageData());

  app.post('/api/settings/maintenance/factory-reset', async (_, reply) => {
    try {
      return factoryReset();
    } catch (err) {
      return sendError(reply, 500, 'internal_error', err instanceof Error ? err.message : '重新初始化系统失败', 'factory_reset_failed');
    }
  });

  app.get('/api/settings/backup/export', async (request, reply) => {
    const parsed = z.object({ type: backupTypeSchema.default('all') }).safeParse(request.query);
    if (!parsed.success) return sendError(reply, 400, 'validation_error', parsed.error.message, 'invalid_payload');
    return exportBackup(parsed.data.type);
  });

  app.post('/api/settings/backup/import', async (request, reply) => {
    const wrapped = backupImportPayloadSchema.safeParse(request.body);
    try {
      return await importBackup(wrapped.success ? wrapped.data.backup : request.body, wrapped.success ? wrapped.data.type : undefined);
    } catch (err) {
      return sendError(reply, 400, 'validation_error', err instanceof Error ? err.message : '导入失败', 'backup_import_failed');
    }
  });

  app.get('/api/settings/backup/webdav', async () => getBackupWebdavConfig());

  app.put('/api/settings/backup/webdav', async (request, reply) => {
    const parsed = backupWebdavConfigPayloadSchema.safeParse(request.body ?? {});
    if (!parsed.success) return sendError(reply, 400, 'validation_error', parsed.error.message, 'invalid_payload');
    try {
      return saveBackupWebdavConfig(parsed.data);
    } catch (err) {
      return sendBackupWebdavError(reply, err, 'WebDAV 配置保存失败', 'backup_webdav_save_failed');
    }
  });

  app.post('/api/settings/backup/webdav/export', async (request, reply) => {
    const parsed = backupWebdavExportPayloadSchema.safeParse(request.body ?? {});
    if (!parsed.success) return sendError(reply, 400, 'validation_error', parsed.error.message, 'invalid_payload');
    try {
      return await exportBackupToWebdav(parsed.data.type);
    } catch (err) {
      return sendBackupWebdavError(reply, err, 'WebDAV 导出失败', 'backup_webdav_export_failed');
    }
  });

  app.post('/api/settings/backup/webdav/import', async (_, reply) => {
    try {
      return await importBackupFromWebdav();
    } catch (err) {
      return sendBackupWebdavError(reply, err, 'WebDAV 导入失败', 'backup_webdav_import_failed');
    }
  });
}
