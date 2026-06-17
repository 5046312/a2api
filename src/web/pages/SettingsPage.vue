<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useMessage } from 'naive-ui';
import { api, type SettingsSnapshot } from '@web/api';

const settings = ref<SettingsSnapshot | null>(null);
const loading = ref(false);
const saving = ref(false);
const testingProxy = ref(false);
const resetting = ref(false);
const error = ref('');
const message = ref('');
const notice = useMessage();
const resetConfirmVisible = ref(false);
const resetConfirmText = ref('');
const form = reactive({
  systemProxyUrl: '',
  adminIpAllowlistText: '',
  proxyFirstByteTimeoutSec: 0,
  proxyMaxChannelAttempts: 3,
  defaultRoutingStrategy: 'weighted',
  tokenRouterCacheTtlMs: 1500,
  balanceRefreshCron: '0 * * * *',
  logCleanupCron: '0 6 * * *',
  logCleanupRetentionDays: 30,
  notificationWebhookEnabled: false,
  notificationWebhookUrl: '',
  clearNotificationWebhookUrl: false,
  notifyCooldownSec: 300
});
const routingStrategyOptions = [
  { label: '加权随机', value: 'weighted' },
  { label: '稳定优先', value: 'stable_first' }
];

watch(message, (value) => {
  if (value) notice.success(value);
});

watch(error, (value) => {
  if (value) notice.error(value);
});

function routingStrategyLabel(value: string) {
  return value === 'stable_first' ? '稳定优先' : '加权随机';
}

const rows = computed(() => {
  if (!settings.value) return [];
  return [
    {
      label: '系统代理',
      value: settings.value.systemProxyUrl || '未配置',
      note: '由 SYSTEM_PROXY_URL 环境变量提供。'
    },
    {
      label: '首字节超时',
      value: settings.value.proxyFirstByteTimeoutSec === 0 ? '关闭' : `${settings.value.proxyFirstByteTimeoutSec} 秒`,
      note: '由 PROXY_FIRST_BYTE_TIMEOUT_SEC 控制。'
    },
    {
      label: '最大通道尝试',
      value: `${settings.value.proxyMaxChannelAttempts} 次`,
      note: '由 PROXY_MAX_CHANNEL_ATTEMPTS 控制。'
    },
    {
      label: '默认调用策略',
      value: routingStrategyLabel(settings.value.defaultRoutingStrategy),
      note: '新建自动模型默认使用，可在模型通道抽屉单独覆盖。'
    },
    {
      label: '模型选择缓存 TTL',
      value: `${settings.value.tokenRouterCacheTtlMs} ms`,
      note: '由 TOKEN_ROUTER_CACHE_TTL_MS 控制。'
    },
    {
      label: '余额刷新 Cron',
      value: settings.value.balanceRefreshCron,
      note: '由 BALANCE_REFRESH_CRON 控制。'
    },
    {
      label: '日志清理 Cron',
      value: settings.value.logCleanupCron,
      note: `保留 ${settings.value.logCleanupRetentionDays} 天代理日志。`
    },
    {
      label: '管理端 IP 白名单',
      value: settings.value.adminIpAllowlist.length > 0 ? settings.value.adminIpAllowlist.join(', ') : '未限制',
      note: '由 ADMIN_IP_ALLOWLIST 控制。'
    },
    {
      label: 'Webhook 通知',
      value: settings.value.notificationWebhookEnabled ? '已启用' : '未启用',
      note: settings.value.notificationWebhookUrlMasked || '未配置 WEBHOOK_URL。'
    },
    {
      label: '通知冷静期',
      value: `${settings.value.notifyCooldownSec} 秒`,
      note: '由 NOTIFY_COOLDOWN_SEC 控制。'
    }
  ];
});

function syncForm(snapshot: SettingsSnapshot) {
  form.systemProxyUrl = snapshot.systemProxyUrl;
  form.adminIpAllowlistText = snapshot.adminIpAllowlist.join('\n');
  form.proxyFirstByteTimeoutSec = snapshot.proxyFirstByteTimeoutSec;
  form.proxyMaxChannelAttempts = snapshot.proxyMaxChannelAttempts;
  form.defaultRoutingStrategy = snapshot.defaultRoutingStrategy;
  form.tokenRouterCacheTtlMs = snapshot.tokenRouterCacheTtlMs;
  form.balanceRefreshCron = snapshot.balanceRefreshCron;
  form.logCleanupCron = snapshot.logCleanupCron;
  form.logCleanupRetentionDays = snapshot.logCleanupRetentionDays;
  form.notificationWebhookEnabled = snapshot.notificationWebhookEnabled;
  form.notificationWebhookUrl = '';
  form.clearNotificationWebhookUrl = false;
  form.notifyCooldownSec = snapshot.notifyCooldownSec;
}

function buildPayload() {
  const payload: Record<string, unknown> = {
    systemProxyUrl: form.systemProxyUrl.trim(),
    adminIpAllowlist: form.adminIpAllowlistText
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean),
    proxyFirstByteTimeoutSec: Number(form.proxyFirstByteTimeoutSec) || 0,
    proxyMaxChannelAttempts: Math.max(1, Math.trunc(Number(form.proxyMaxChannelAttempts) || 1)),
    defaultRoutingStrategy: form.defaultRoutingStrategy,
    tokenRouterCacheTtlMs: Math.max(100, Math.trunc(Number(form.tokenRouterCacheTtlMs) || 100)),
    balanceRefreshCron: form.balanceRefreshCron.trim(),
    logCleanupCron: form.logCleanupCron.trim(),
    logCleanupRetentionDays: Math.max(1, Math.trunc(Number(form.logCleanupRetentionDays) || 1)),
    notificationWebhookEnabled: form.notificationWebhookEnabled,
    clearNotificationWebhookUrl: form.clearNotificationWebhookUrl,
    notifyCooldownSec: Math.max(0, Math.trunc(Number(form.notifyCooldownSec) || 0))
  };
  const webhookUrl = form.notificationWebhookUrl.trim();
  if (webhookUrl) payload.notificationWebhookUrl = webhookUrl;
  return payload;
}

async function loadSettings() {
  loading.value = true;
  error.value = '';
  message.value = '';
  try {
    settings.value = await api.getSettings();
    syncForm(settings.value);
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加载设置失败';
  } finally {
    loading.value = false;
  }
}

async function saveSettings() {
  saving.value = true;
  error.value = '';
  message.value = '';
  try {
    settings.value = await api.updateSettings(buildPayload());
    syncForm(settings.value);
    message.value = '设置已保存并即时生效';
  } catch (err) {
    error.value = err instanceof Error ? err.message : '保存设置失败';
  } finally {
    saving.value = false;
  }
}

async function testSystemProxy() {
  testingProxy.value = true;
  error.value = '';
  message.value = '';
  try {
    const result = await api.testSystemProxy({ proxyUrl: form.systemProxyUrl.trim() });
    message.value = `系统代理可达：HTTP ${result.statusCode}，耗时 ${result.latencyMs} ms`;
  } catch (err) {
    error.value = err instanceof Error ? err.message : '测试系统代理失败';
  } finally {
    testingProxy.value = false;
  }
}

async function testNotifications() {
  saving.value = true;
  error.value = '';
  message.value = '';
  try {
    settings.value = await api.updateSettings(buildPayload());
    syncForm(settings.value);
    const result = await api.testNotifications();
    message.value = result.message;
  } catch (err) {
    error.value = err instanceof Error ? err.message : '测试通知失败';
  } finally {
    saving.value = false;
  }
}

async function factoryReset() {
  resetConfirmText.value = '';
  resetConfirmVisible.value = true;
}

async function confirmFactoryReset() {
  if (resetConfirmText.value !== 'RESET') {
    error.value = '请输入 RESET 确认重新初始化系统';
    return;
  }
  resetting.value = true;
  error.value = '';
  message.value = '';
  try {
    const result = await api.factoryReset();
    await loadSettings();
    message.value = result.message;
  } catch (err) {
    error.value = err instanceof Error ? err.message : '重新初始化系统失败';
  } finally {
    resetting.value = false;
    resetConfirmVisible.value = false;
  }
}

onMounted(loadSettings);
</script>

<template>
  <section class="page-stack">
    <n-card class="admin-card" :bordered="false">
      <div class="panel-header">
        <div>
          <h2>运行设置</h2>
          <p class="muted">保存后写入数据库，并覆盖同名环境变量的运行时值。</p>
        </div>
        <n-button secondary attr-type="button" @click="loadSettings">刷新</n-button>
      </div>
      <form class="form-grid" @submit.prevent="saveSettings">
        <label class="field">
          <span>系统代理</span>
          <n-input v-model:value="form.systemProxyUrl" placeholder="socks5://127.0.0.1:1080" />
        </label>
        <label class="field">
          <span>首字节超时（秒）</span>
          <n-input-number v-model:value="form.proxyFirstByteTimeoutSec" :min="0" />
        </label>
        <label class="field">
          <span>最大通道尝试</span>
          <n-input-number v-model:value="form.proxyMaxChannelAttempts" :min="1" :max="20" />
        </label>
        <label class="field">
          <span>默认调用策略</span>
          <n-select v-model:value="form.defaultRoutingStrategy" :options="routingStrategyOptions" />
        </label>
        <label class="field">
          <span>模型选择缓存 TTL（ms）</span>
          <n-input-number v-model:value="form.tokenRouterCacheTtlMs" :min="100" :step="100" />
        </label>
        <label class="field">
          <span>余额刷新 Cron</span>
          <n-input v-model:value="form.balanceRefreshCron" placeholder="0 * * * *" />
        </label>
        <label class="field">
          <span>日志清理 Cron</span>
          <n-input v-model:value="form.logCleanupCron" placeholder="0 6 * * *" />
        </label>
        <label class="field">
          <span>日志保留天数</span>
          <n-input-number v-model:value="form.logCleanupRetentionDays" :min="1" />
        </label>
        <label class="field wide">
          <span>管理端 IP 白名单</span>
          <n-input type="textarea" v-model:value="form.adminIpAllowlistText" :rows="4" placeholder="每行一个 IP，留空表示不限制"></n-input>
        </label>
        <label class="check-row wide">
          <n-checkbox v-model:checked="form.notificationWebhookEnabled">启用 Webhook 通知</n-checkbox>
        </label>
        <label class="field wide">
          <span>Webhook URL</span>
          <n-input v-model:value="form.notificationWebhookUrl" placeholder="留空保留已保存地址" />
        </label>
        <label class="check-row wide">
          <n-checkbox v-model:checked="form.clearNotificationWebhookUrl">清空已保存 Webhook URL</n-checkbox>
        </label>
        <label class="field">
          <span>通知冷静期（秒）</span>
          <n-input-number v-model:value="form.notifyCooldownSec" :min="0" />
        </label>
        <div class="form-actions wide">
          <n-button type="primary" attr-type="submit" :disabled="saving">{{ saving ? '保存中' : '保存设置' }}</n-button>
          <n-button secondary attr-type="button" :disabled="testingProxy || saving" @click="testSystemProxy">
            {{ testingProxy ? '测试中' : '测试系统代理' }}
          </n-button>
          <n-button secondary attr-type="button" :disabled="saving" @click="testNotifications">测试通知</n-button>
        </div>
      </form>
      <div v-if="loading" class="empty">加载中</div>
      <div v-else class="settings-grid">
        <article v-for="row in rows" :key="row.label" class="setting-item">
          <span class="setting-label">{{ row.label }}</span>
          <strong class="setting-value">{{ row.value }}</strong>
          <span class="setting-note">{{ row.note }}</span>
        </article>
      </div>
    </n-card>

    <n-card class="admin-card" :bordered="false">
      <div class="panel-header">
        <div>
          <h2>环境变量</h2>
          <p class="muted">这些配置来自服务端环境，不在前端保存 secret。</p>
        </div>
      </div>
      <div class="table-wrap">
        <n-table size="small" :bordered="false" single-line class="admin-table">
          <thead>
            <tr>
              <th>变量</th>
              <th>作用</th>
              <th>当前状态</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="mono">SYSTEM_PROXY_URL</td>
              <td>系统级上游代理。</td>
              <td>{{ settings?.systemProxyUrl ? '已配置' : '未配置' }}</td>
            </tr>
            <tr>
              <td class="mono">PROXY_FIRST_BYTE_TIMEOUT_SEC</td>
              <td>代理首字节超时。</td>
              <td>{{ settings?.proxyFirstByteTimeoutSec === 0 ? '关闭' : '已启用' }}</td>
            </tr>
            <tr>
              <td class="mono">PROXY_MAX_CHANNEL_ATTEMPTS</td>
              <td>单次请求最多尝试通道数。</td>
              <td>{{ settings?.proxyMaxChannelAttempts || '-' }}</td>
            </tr>
            <tr>
              <td class="mono">DEFAULT_ROUTING_STRATEGY</td>
              <td>新建自动模型默认调用策略。</td>
              <td>{{ settings ? routingStrategyLabel(settings.defaultRoutingStrategy) : '-' }}</td>
            </tr>
            <tr>
              <td class="mono">TOKEN_ROUTER_CACHE_TTL_MS</td>
              <td>模型选择缓存有效期。</td>
              <td>{{ settings?.tokenRouterCacheTtlMs || '-' }} ms</td>
            </tr>
            <tr>
              <td class="mono">BALANCE_REFRESH_CRON</td>
              <td>定时刷新所有 active 账号余额。</td>
              <td>{{ settings?.balanceRefreshCron || '-' }}</td>
            </tr>
            <tr>
              <td class="mono">LOG_CLEANUP_CRON</td>
              <td>定时清理过期代理日志。</td>
              <td>{{ settings?.logCleanupCron || '-' }}</td>
            </tr>
            <tr>
              <td class="mono">LOG_CLEANUP_RETENTION_DAYS</td>
              <td>代理日志保留天数。</td>
              <td>{{ settings?.logCleanupRetentionDays ?? '-' }} 天</td>
            </tr>
            <tr>
              <td class="mono">ADMIN_IP_ALLOWLIST</td>
              <td>管理端允许访问的 IP 列表。</td>
              <td>{{ settings?.adminIpAllowlist.length ? '已限制' : '未限制' }}</td>
            </tr>
            <tr>
              <td class="mono">WEBHOOK_URL</td>
              <td>Webhook 通知地址。</td>
              <td>{{ settings?.notificationWebhookUrlMasked || '未配置' }}</td>
            </tr>
            <tr>
              <td class="mono">WEBHOOK_ENABLED</td>
              <td>是否启用 Webhook 通知。</td>
              <td>{{ settings?.notificationWebhookEnabled ? '已启用' : '未启用' }}</td>
            </tr>
            <tr>
              <td class="mono">NOTIFY_COOLDOWN_SEC</td>
              <td>通知冷静期。</td>
              <td>{{ settings?.notifyCooldownSec ?? '-' }} 秒</td>
            </tr>
          </tbody>
        </n-table>
      </div>
    </n-card>

    <n-card class="admin-card" :bordered="false">
      <div class="panel-header">
        <div>
          <h2>维护操作</h2>
          <p class="muted">清空业务数据、运行设置和 WebDAV 自动任务，保留当前环境中的管理 Token 与数据库路径。</p>
        </div>
      </div>
      <div class="form-actions">
        <n-button type="error" attr-type="button" :disabled="resetting" @click="factoryReset">
          {{ resetting ? '处理中' : '重新初始化系统' }}
        </n-button>
      </div>
    </n-card>

    <n-modal v-model:show="resetConfirmVisible" preset="card" title="重新初始化系统" class="reset-modal">
      <p class="muted">输入 RESET 确认清空业务数据、运行设置和 WebDAV 自动任务。</p>
      <n-input v-model:value="resetConfirmText" placeholder="RESET" />
      <template #footer>
        <div class="form-actions">
          <n-button secondary attr-type="button" @click="resetConfirmVisible = false">取消</n-button>
          <n-button
            type="error"
            attr-type="button"
            :disabled="resetting || resetConfirmText !== 'RESET'"
            @click="confirmFactoryReset"
          >
            {{ resetting ? '处理中' : '确认重新初始化' }}
          </n-button>
        </div>
      </template>
    </n-modal>
  </section>
</template>

<style scoped lang="scss">
.reset-modal {
  width: min(420px, calc(100vw - 32px));
}
</style>
