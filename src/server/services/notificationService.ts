import { fetch } from 'undici';
import { config } from '../config.js';
import { fetchDispatcher } from '../shared/http.js';

export type NotificationLevel = 'info' | 'warning' | 'error';

export type NotificationDispatchResult = {
  attempted: number;
  succeeded: number;
  failed: number;
};

function isWeComWebhook(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'qyapi.weixin.qq.com' && parsed.pathname.includes('/cgi-bin/webhook/send');
  } catch {
    return false;
  }
}

function isFeishuWebhook(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (parsed.hostname === 'open.feishu.cn' || parsed.hostname === 'open.larksuite.com')
      && parsed.pathname.includes('/open-apis/bot/v2/hook/');
  } catch {
    return false;
  }
}

function buildText(title: string, message: string, level: NotificationLevel): string {
  return `[a2api][${level.toUpperCase()}] ${title}\n\n${message}\n\nUTC Time: ${new Date().toISOString()}`;
}

function buildWebhookPayload(url: string, title: string, message: string, level: NotificationLevel): unknown {
  const text = buildText(title, message, level);
  // 常见机器人 Webhook 需要专用 text 格式，其他地址使用通用 JSON。
  if (isWeComWebhook(url)) {
    return { msgtype: 'text', text: { content: text.slice(0, 1900) } };
  }
  if (isFeishuWebhook(url)) {
    return { msg_type: 'text', content: { text: text.slice(0, 3900) } };
  }
  return {
    source: 'a2api',
    title,
    message,
    level,
    timestamp: new Date().toISOString()
  };
}

async function assertWebhookBusinessResult(url: string, response: Awaited<ReturnType<typeof fetch>>): Promise<void> {
  if (!isWeComWebhook(url) && !isFeishuWebhook(url)) return;
  const payload = await response.json().catch(() => null) as { errcode?: number; errmsg?: string; code?: number; msg?: string } | null;
  if (isWeComWebhook(url) && typeof payload?.errcode === 'number' && payload.errcode !== 0) {
    throw new Error(`企业微信 Webhook 返回错误 ${payload.errcode}: ${payload.errmsg || 'unknown error'}`);
  }
  if (isFeishuWebhook(url) && typeof payload?.code === 'number' && payload.code !== 0) {
    throw new Error(`飞书 Webhook 返回错误 ${payload.code}: ${payload.msg || 'unknown error'}`);
  }
}

export async function sendNotification(title: string, message: string, level: NotificationLevel = 'info'): Promise<NotificationDispatchResult> {
  if (!config.notificationWebhookEnabled || !config.notificationWebhookUrl) {
    throw new Error('未启用 Webhook 通知');
  }

  const dispatcher = fetchDispatcher();
  const response = await fetch(config.notificationWebhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildWebhookPayload(config.notificationWebhookUrl, title, message, level)),
    ...(dispatcher ? { dispatcher } : {})
  });
  if (!response.ok) {
    throw new Error(`Webhook 响应状态 ${response.status}`);
  }
  await assertWebhookBusinessResult(config.notificationWebhookUrl, response);
  return { attempted: 1, succeeded: 1, failed: 0 };
}

export async function sendTestNotification(): Promise<NotificationDispatchResult> {
  return sendNotification(
    '测试通知',
    '您好，这是一条来自 a2api 设置页的连通性测试通知。',
    'info'
  );
}
