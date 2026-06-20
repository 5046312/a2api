<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useMessage } from 'naive-ui';
import { api, type SettingsSnapshot } from '@web/api';

type TemporaryDisableRuleForm = {
  uid: number;
  statusCode: number | null;
  keywordsText: string;
  durationMinutes: number;
  description: string;
};

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
let nextTemporaryRuleUid = 1;
const form = reactive({
  systemProxyUrl: '',
  adminIpAllowlistText: '',
  proxyFirstByteTimeoutSec: 0,
  proxyMaxChannelAttempts: 3,
  proxyChannelRetryAttempts: 1,
  defaultRoutingStrategy: 'weighted',
  tokenRouterCacheTtlMs: 1500,
  balanceRefreshCron: '0 * * * *',
  logCleanupCron: '0 6 * * *',
  logCleanupRetentionDays: 30,
  notificationWebhookEnabled: false,
  notificationWebhookUrl: '',
  clearNotificationWebhookUrl: false,
  notifyCooldownSec: 300,
  temporaryDisableEnabled: false,
  temporaryDisableRules: [] as TemporaryDisableRuleForm[]
});
const routingStrategyOptions = [
  { label: '加权随机', value: 'weighted' },
  { label: '稳定优先', value: 'stable_first' },
  { label: '轮询', value: 'round_robin' }
];
const temporaryDisablePresets: Omit<TemporaryDisableRuleForm, 'uid'>[] = [
  { statusCode: 403, keywordsText: 'quota, exceeded, insufficient', durationMinutes: 60, description: '额度不足' },
  { statusCode: 429, keywordsText: 'rate limit, too many requests', durationMinutes: 10, description: '上游限流' },
  { statusCode: 503, keywordsText: 'unavailable, maintenance', durationMinutes: 30, description: '服务维护' },
  { statusCode: 529, keywordsText: 'overloaded, too many', durationMinutes: 60, description: '上游过载' }
];

watch(message, (value) => {
  if (value) notice.success(value);
});

watch(error, (value) => {
  if (value) notice.error(value);
});

function routingStrategyLabel(value: string) {
  if (value === 'stable_first') return '稳定优先';
  if (value === 'round_robin') return '轮询';
  return '加权随机';
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
      label: '最多尝试通道数',
      value: `${settings.value.proxyMaxChannelAttempts} 次`,
      note: '单个请求最多尝试的不同通道数。'
    },
    {
      label: '通道重试次数',
      value: `${settings.value.proxyChannelRetryAttempts} 次`,
      note: '单个命中通道连续失败达到该次数后，再切换下一通道。'
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
      label: '临时禁用规则',
      value: settings.value.temporaryDisableEnabled ? `已启用，${settings.value.temporaryDisableRules.length} 条规则` : '未启用',
      note: '命中状态码和关键词后，当前通道会临时进入冷却。'
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

function splitTemporaryDisableKeywords(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function createTemporaryDisableRuleForm(rule: Omit<TemporaryDisableRuleForm, 'uid'>): TemporaryDisableRuleForm {
  return {
    uid: nextTemporaryRuleUid++,
    ...rule
  };
}

function syncForm(snapshot: SettingsSnapshot) {
  form.systemProxyUrl = snapshot.systemProxyUrl;
  form.adminIpAllowlistText = snapshot.adminIpAllowlist.join('\n');
  form.proxyFirstByteTimeoutSec = snapshot.proxyFirstByteTimeoutSec;
  form.proxyMaxChannelAttempts = snapshot.proxyMaxChannelAttempts;
  form.proxyChannelRetryAttempts = snapshot.proxyChannelRetryAttempts;
  form.defaultRoutingStrategy = snapshot.defaultRoutingStrategy;
  form.tokenRouterCacheTtlMs = snapshot.tokenRouterCacheTtlMs;
  form.balanceRefreshCron = snapshot.balanceRefreshCron;
  form.logCleanupCron = snapshot.logCleanupCron;
  form.logCleanupRetentionDays = snapshot.logCleanupRetentionDays;
  form.notificationWebhookEnabled = snapshot.notificationWebhookEnabled;
  form.notificationWebhookUrl = '';
  form.clearNotificationWebhookUrl = false;
  form.notifyCooldownSec = snapshot.notifyCooldownSec;
  form.temporaryDisableEnabled = snapshot.temporaryDisableEnabled;
  form.temporaryDisableRules.splice(0, form.temporaryDisableRules.length, ...snapshot.temporaryDisableRules.map((rule) => createTemporaryDisableRuleForm({
    statusCode: rule.statusCode,
    keywordsText: rule.keywords.join(', '),
    durationMinutes: rule.durationMinutes,
    description: rule.description
  })));
}

function buildTemporaryDisableRules() {
  return form.temporaryDisableRules.map((rule, index) => {
    const statusCode = Math.trunc(Number(rule.statusCode) || 0);
    const durationMinutes = Math.trunc(Number(rule.durationMinutes) || 0);
    const keywords = splitTemporaryDisableKeywords(rule.keywordsText);
    if (statusCode < 100 || statusCode > 599) throw new Error(`临时禁用规则 #${index + 1} 的状态码必须是 100-599`);
    if (durationMinutes < 1) throw new Error(`临时禁用规则 #${index + 1} 的冷却分钟必须大于 0`);
    if (keywords.length === 0) throw new Error(`临时禁用规则 #${index + 1} 至少填写一个关键词`);
    return {
      statusCode,
      keywords,
      durationMinutes,
      description: rule.description.trim()
    };
  });
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
    proxyChannelRetryAttempts: Math.max(1, Math.trunc(Number(form.proxyChannelRetryAttempts) || 1)),
    defaultRoutingStrategy: form.defaultRoutingStrategy,
    tokenRouterCacheTtlMs: Math.max(100, Math.trunc(Number(form.tokenRouterCacheTtlMs) || 100)),
    balanceRefreshCron: form.balanceRefreshCron.trim(),
    logCleanupCron: form.logCleanupCron.trim(),
    logCleanupRetentionDays: Math.max(1, Math.trunc(Number(form.logCleanupRetentionDays) || 1)),
    notificationWebhookEnabled: form.notificationWebhookEnabled,
    clearNotificationWebhookUrl: form.clearNotificationWebhookUrl,
    notifyCooldownSec: Math.max(0, Math.trunc(Number(form.notifyCooldownSec) || 0)),
    temporaryDisableEnabled: form.temporaryDisableEnabled,
    temporaryDisableRules: form.temporaryDisableEnabled ? buildTemporaryDisableRules() : []
  };
  const webhookUrl = form.notificationWebhookUrl.trim();
  if (webhookUrl) payload.notificationWebhookUrl = webhookUrl;
  return payload;
}

function addTemporaryDisableRule(preset?: Omit<TemporaryDisableRuleForm, 'uid'>) {
  form.temporaryDisableRules.push(createTemporaryDisableRuleForm({
    statusCode: preset?.statusCode ?? null,
    keywordsText: preset?.keywordsText ?? '',
    durationMinutes: preset?.durationMinutes ?? 30,
    description: preset?.description ?? ''
  }));
}

function removeTemporaryDisableRule(index: number) {
  form.temporaryDisableRules.splice(index, 1);
}

function moveTemporaryDisableRule(index: number, direction: number) {
  const target = index + direction;
  if (target < 0 || target >= form.temporaryDisableRules.length) return;
  const current = form.temporaryDisableRules[index]!;
  form.temporaryDisableRules[index] = form.temporaryDisableRules[target]!;
  form.temporaryDisableRules[target] = current;
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
          <h2>系统设置</h2>
          <p class="muted">保存后写入数据库，并覆盖同名环境变量的运行时值。</p>
        </div>
        <n-button secondary attr-type="button" :disabled="loading" @click="loadSettings">
          {{ loading ? '刷新中' : '刷新' }}
        </n-button>
      </div>

      <form class="settings-form" @submit.prevent="saveSettings">
        <n-tabs type="line" animated class="settings-tabs">
          <n-tab-pane name="proxy" tab="代理与调度">
            <div class="form-grid">
              <label class="field wide">
                <span>系统代理</span>
                <n-input v-model:value="form.systemProxyUrl" placeholder="socks5://127.0.0.1:1080" />
              </label>
              <label class="field">
                <span>首字节超时（秒）</span>
                <n-input-number v-model:value="form.proxyFirstByteTimeoutSec" :min="0" />
              </label>
              <label class="field">
                <span>最多尝试通道数</span>
                <n-input-number v-model:value="form.proxyMaxChannelAttempts" :min="1" :max="20" />
              </label>
              <label class="field">
                <span>通道重试次数</span>
                <n-input-number v-model:value="form.proxyChannelRetryAttempts" :min="1" :max="20" />
              </label>
              <label class="field">
                <span>默认调用策略</span>
                <n-select v-model:value="form.defaultRoutingStrategy" :options="routingStrategyOptions" />
              </label>
              <label class="field">
                <span>模型选择缓存 TTL（ms）</span>
                <n-input-number v-model:value="form.tokenRouterCacheTtlMs" :min="100" :step="100" />
              </label>
              <div class="form-actions wide">
                <n-button secondary attr-type="button" :disabled="testingProxy || saving" @click="testSystemProxy">
                  {{ testingProxy ? '测试中' : '测试系统代理' }}
                </n-button>
              </div>
            </div>

            <div v-if="loading" class="empty">加载中</div>
            <div v-else class="settings-grid">
              <article v-for="row in rows" :key="row.label" class="setting-item">
                <span class="setting-label">{{ row.label }}</span>
                <strong class="setting-value">{{ row.value }}</strong>
                <span class="setting-note">{{ row.note }}</span>
              </article>
            </div>
          </n-tab-pane>

          <n-tab-pane name="temporary-disable" tab="临时禁用规则">
            <div class="temporary-disable-header">
              <div>
                <label class="check-row">
                  <n-checkbox v-model:checked="form.temporaryDisableEnabled">启用临时禁用规则</n-checkbox>
                </label>
                <p class="muted">上游错误同时命中状态码和任一关键词时，当前通道进入临时冷却并继续尝试下一通道。</p>
              </div>
              <n-button secondary attr-type="button" :disabled="!form.temporaryDisableEnabled" @click="addTemporaryDisableRule()">新增规则</n-button>
            </div>

            <div v-if="form.temporaryDisableEnabled" class="temporary-disable-body">
              <div class="rule-preset-row">
                <n-button
                  v-for="preset in temporaryDisablePresets"
                  :key="`${preset.statusCode}-${preset.description}`"
                  secondary
                  size="small"
                  attr-type="button"
                  @click="addTemporaryDisableRule(preset)"
                >
                  + {{ preset.statusCode }} {{ preset.description }}
                </n-button>
              </div>

              <div v-if="form.temporaryDisableRules.length === 0" class="empty">暂无规则</div>
              <div v-else class="temporary-rule-list">
                <article v-for="(rule, index) in form.temporaryDisableRules" :key="rule.uid" class="temporary-rule-card">
                  <div class="rule-header">
                    <strong>规则 #{{ index + 1 }}</strong>
                    <div class="rule-actions">
                      <n-button text attr-type="button" :disabled="index === 0" @click="moveTemporaryDisableRule(index, -1)">上移</n-button>
                      <n-button
                        text
                        attr-type="button"
                        :disabled="index === form.temporaryDisableRules.length - 1"
                        @click="moveTemporaryDisableRule(index, 1)"
                      >
                        下移
                      </n-button>
                      <n-button text type="error" attr-type="button" @click="removeTemporaryDisableRule(index)">删除</n-button>
                    </div>
                  </div>

                  <div class="form-grid rule-grid">
                    <label class="field">
                      <span>状态码</span>
                      <n-input-number v-model:value="rule.statusCode" :min="100" :max="599" />
                    </label>
                    <label class="field">
                      <span>冷却分钟</span>
                      <n-input-number v-model:value="rule.durationMinutes" :min="1" />
                    </label>
                    <label class="field wide">
                      <span>关键词</span>
                      <n-input v-model:value="rule.keywordsText" placeholder="多个关键词用英文逗号分隔" />
                    </label>
                    <label class="field wide">
                      <span>说明</span>
                      <n-input v-model:value="rule.description" placeholder="例如：额度不足、上游限流" />
                    </label>
                  </div>
                </article>
              </div>
            </div>
          </n-tab-pane>

          <n-tab-pane name="tasks" tab="任务与日志">
            <div class="form-grid">
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
            </div>
          </n-tab-pane>

          <n-tab-pane name="notifications" tab="通知">
            <div class="form-grid">
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
                <n-button secondary attr-type="button" :disabled="saving" @click="testNotifications">测试通知</n-button>
              </div>
            </div>
          </n-tab-pane>

          <n-tab-pane name="security" tab="安全与维护">
            <div class="form-grid">
              <label class="field wide">
                <span>管理端 IP 白名单</span>
                <n-input type="textarea" v-model:value="form.adminIpAllowlistText" :rows="4" placeholder="每行一个 IP，留空表示不限制"></n-input>
              </label>
            </div>

            <div class="settings-section">
              <div class="panel-header compact">
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
                      <td>单个请求最多尝试的不同通道数。</td>
                      <td>{{ settings?.proxyMaxChannelAttempts || '-' }}</td>
                    </tr>
                    <tr>
                      <td class="mono">PROXY_CHANNEL_RETRY_ATTEMPTS</td>
                      <td>单个命中通道连续失败达到该次数后，再切换下一通道。</td>
                      <td>{{ settings?.proxyChannelRetryAttempts || '-' }}</td>
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
            </div>

            <div class="settings-section">
              <div class="panel-header compact">
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
            </div>
          </n-tab-pane>
        </n-tabs>

        <div class="form-actions settings-actions">
          <n-button type="primary" attr-type="submit" :disabled="saving">{{ saving ? '保存中' : '保存设置' }}</n-button>
        </div>
      </form>
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
.settings-form {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.settings-tabs {
  margin-top: 6px;
}

.settings-actions {
  border-top: 1px solid rgba(148, 163, 184, 0.2);
  padding-top: 16px;
}

.temporary-disable-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.temporary-disable-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.rule-preset-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.temporary-rule-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.temporary-rule-card {
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 8px;
  padding: 14px;
}

.rule-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.rule-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.rule-grid {
  margin-top: 0;
}

.settings-section {
  margin-top: 24px;
}

.panel-header.compact {
  margin-bottom: 12px;
}

.reset-modal {
  width: min(420px, calc(100vw - 32px));
}

@media (max-width: 720px) {
  .temporary-disable-header {
    flex-direction: column;
  }

  .rule-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .rule-actions {
    flex-wrap: wrap;
  }
}
</style>
