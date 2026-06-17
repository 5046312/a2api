<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useMessage } from 'naive-ui';
import { api, type MonitorAccount, type MonitorOverview, type MonitorSettings, type MonitorStatus } from '@web/api';

const overview = ref<MonitorOverview | null>(null);
const accounts = ref<MonitorAccount[]>([]);
const selectedAccount = ref<MonitorAccount | null>(null);
const loading = ref(false);
const probingAll = ref(false);
const probingAccountId = ref<number | null>(null);
const savingSettings = ref(false);
const error = ref('');
const message = ref('');
const notice = useMessage();
const filters = reactive({
  status: 'all',
  keyword: ''
});

watch(message, (value) => {
  if (value) notice.success(value);
});

watch(error, (value) => {
  if (value) notice.error(value);
});
const statusFilterOptions = [
  { label: '全部', value: 'all' },
  { label: '可用', value: 'up' },
  { label: '故障', value: 'down' },
  { label: '待检查', value: 'pending' },
  { label: '停用', value: 'maintenance' },
  { label: '禁用上游账号', value: 'disabled' }
];
const settingsForm = reactive<MonitorSettings>({
  enabled: true,
  intervalSec: 300,
  timeoutSec: 20,
  maxRetries: 1,
  concurrency: 3,
  retentionDays: 30,
  notifyOnDown: true,
  notifyOnRecovery: true
});

const summaryCards = computed(() => {
  const data = overview.value;
  return [
    { label: '全部上游账号', value: data?.totalAccounts ?? 0 },
    { label: '可用', value: data?.statusCount.up ?? 0 },
    { label: '故障', value: data?.statusCount.down ?? 0 },
    { label: '待检查', value: data?.statusCount.pending ?? 0 },
    { label: '平均延迟', value: formatLatency(data?.averageLatencyMs) },
    { label: '24h 可用率', value: formatPercent(data?.uptime24h) }
  ];
});

function setError(err: unknown, fallback: string) {
  error.value = err instanceof Error ? err.message : fallback;
}

function formatTime(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : '-';
}

function formatLatency(value: number | null | undefined) {
  return typeof value === 'number' ? `${value}ms` : '-';
}

function formatPercent(value: number | null | undefined) {
  return typeof value === 'number' ? `${value.toFixed(2)}%` : '-';
}

function statusText(status: MonitorStatus) {
  const labels: Record<MonitorStatus, string> = {
    up: '可用',
    down: '故障',
    pending: '待检查',
    maintenance: '停用'
  };
  return labels[status];
}

function statusClass(status: MonitorStatus) {
  return `status-${status}`;
}

function accountQuery() {
  const query: Record<string, string> = {};
  if (filters.status !== 'all') query.status = filters.status;
  if (filters.keyword.trim()) query.keyword = filters.keyword.trim();
  return query;
}

function applySettings(settings: MonitorSettings) {
  settingsForm.enabled = settings.enabled;
  settingsForm.intervalSec = settings.intervalSec;
  settingsForm.timeoutSec = settings.timeoutSec;
  settingsForm.maxRetries = settings.maxRetries;
  settingsForm.concurrency = settings.concurrency;
  settingsForm.retentionDays = settings.retentionDays;
  settingsForm.notifyOnDown = settings.notifyOnDown;
  settingsForm.notifyOnRecovery = settings.notifyOnRecovery;
}

async function loadMonitor() {
  loading.value = true;
  error.value = '';
  try {
    const [overviewData, accountData] = await Promise.all([
      api.getMonitorOverview(),
      api.listMonitorAccounts(accountQuery())
    ]);
    overview.value = overviewData;
    applySettings(overviewData.settings);
    accounts.value = accountData.items;
    if (selectedAccount.value) {
      const matched = accountData.items.find((item) => item.accountId === selectedAccount.value?.accountId);
      selectedAccount.value = matched ? await api.getMonitorAccount(matched.accountId) : null;
    } else if (accountData.items[0]) {
      selectedAccount.value = await api.getMonitorAccount(accountData.items[0].accountId);
    }
  } catch (err) {
    setError(err, '加载监控失败');
  } finally {
    loading.value = false;
  }
}

async function selectAccount(account: MonitorAccount) {
  error.value = '';
  try {
    selectedAccount.value = await api.getMonitorAccount(account.accountId);
  } catch (err) {
    setError(err, '加载上游账号监控详情失败');
  }
}

async function checkAccount(account: MonitorAccount) {
  probingAccountId.value = account.accountId;
  error.value = '';
  message.value = '';
  try {
    const result = await api.checkMonitorAccount(account.accountId);
    message.value = `上游账号检查完成：${statusText(result.status)} ${result.message}`;
    await loadMonitor();
    const matched = accounts.value.find((item) => item.accountId === account.accountId);
    if (matched) await selectAccount(matched);
  } catch (err) {
    setError(err, '上游账号检查失败');
  } finally {
    probingAccountId.value = null;
  }
}

async function checkAll() {
  probingAll.value = true;
  error.value = '';
  message.value = '';
  try {
    const result = await api.checkAllMonitorAccounts();
    message.value = `全量检查完成：可用 ${result.succeeded}，故障 ${result.failed}，跳过 ${result.skipped}`;
    await loadMonitor();
  } catch (err) {
    setError(err, '全量检查失败');
  } finally {
    probingAll.value = false;
  }
}

async function toggleMonitor(account: MonitorAccount) {
  error.value = '';
  try {
    await api.updateMonitorAccount(account.accountId, { enabled: !account.enabled });
    await loadMonitor();
  } catch (err) {
    setError(err, '更新监控状态失败');
  }
}

async function saveSettings() {
  savingSettings.value = true;
  error.value = '';
  message.value = '';
  try {
    const next = await api.updateMonitorSettings({
      enabled: settingsForm.enabled,
      intervalSec: Number(settingsForm.intervalSec),
      timeoutSec: Number(settingsForm.timeoutSec),
      maxRetries: Number(settingsForm.maxRetries),
      concurrency: Number(settingsForm.concurrency),
      retentionDays: Number(settingsForm.retentionDays),
      notifyOnDown: settingsForm.notifyOnDown,
      notifyOnRecovery: settingsForm.notifyOnRecovery
    });
    applySettings(next);
    message.value = '监控设置已保存';
    await loadMonitor();
  } catch (err) {
    setError(err, '保存监控设置失败');
  } finally {
    savingSettings.value = false;
  }
}

onMounted(loadMonitor);
</script>

<template>
  <section class="page-stack">
    <n-card class="admin-card" :bordered="false">
      <div class="panel-header">
        <div>
          <h2>上游账号可用性监控</h2>
          <p class="muted">定时探测所有上游账号的模型接口，不发起真实对话请求。</p>
        </div>
        <div class="form-actions">
          <n-button secondary attr-type="button" :disabled="loading" @click="loadMonitor">刷新</n-button>
          <n-button type="primary" attr-type="button" :disabled="probingAll" @click="checkAll">
            {{ probingAll ? '检查中' : '全量检查' }}
          </n-button>
        </div>
      </div>

      <div class="monitor-summary">
        <div v-for="card in summaryCards" :key="card.label" class="summary-card">
          <span>{{ card.label }}</span>
          <strong>{{ card.value }}</strong>
        </div>
      </div>
    </n-card>

    <div class="two-column monitor-layout">
      <n-card class="admin-card" :bordered="false">
        <div class="panel-header">
          <div>
            <h2>上游账号列表</h2>
            <p class="muted">按状态筛选当前监控对象。</p>
          </div>
        </div>

        <div class="monitor-filters">
          <label class="field">
            <span>状态</span>
            <n-select v-model:value="filters.status" :options="statusFilterOptions" @update:value="loadMonitor" />
          </label>
          <label class="field">
            <span>关键词</span>
            <n-input v-model:value="filters.keyword" placeholder="上游账号、平台" @keyup.enter="loadMonitor" />
          </label>
          <n-button secondary attr-type="button" @click="loadMonitor">筛选</n-button>
        </div>

        <div class="table-wrap">
          <n-table size="small" :bordered="false" single-line class="admin-table">
            <thead>
              <tr>
                <th>状态</th>
                <th>上游账号</th>
                <th>平台</th>
                <th>延迟</th>
                <th>24h</th>
                <th>心跳</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="account in accounts"
                :key="account.accountId"
                :class="{ selected: selectedAccount?.accountId === account.accountId }"
                @click="selectAccount(account)"
              >
                <td>
                  <span class="status-badge" :class="statusClass(account.status)">{{ statusText(account.status) }}</span>
                </td>
                <td>
                  <strong>{{ account.accountName }}</strong>
                </td>
                <td>
                  <span>{{ account.sitePlatform }}</span>
                </td>
                <td>{{ formatLatency(account.latencyMs) }}</td>
                <td>{{ formatPercent(account.uptime24h) }}</td>
                <td>
                  <div class="heartbeat-bars">
                    <span
                      v-for="heartbeat in account.heartbeats"
                      :key="heartbeat.id"
                      class="heartbeat-bar"
                      :class="statusClass(heartbeat.status)"
                      :title="`${statusText(heartbeat.status)} ${formatTime(heartbeat.checkedAt)}`"
                    ></span>
                  </div>
                </td>
                <td>
                  <div class="row-actions" @click.stop>
                    <n-button text attr-type="button" :disabled="probingAccountId === account.accountId" @click="checkAccount(account)">
                      {{ probingAccountId === account.accountId ? '检查中' : '检查' }}
                    </n-button>
                    <n-button text attr-type="button" @click="toggleMonitor(account)">
                      {{ account.enabled ? '停用' : '启用' }}
                    </n-button>
                  </div>
                </td>
              </tr>
              <tr v-if="accounts.length === 0">
                <td colspan="7" class="empty-cell">{{ loading ? '加载中' : '暂无上游账号监控数据' }}</td>
              </tr>
            </tbody>
          </n-table>
        </div>
      </n-card>

      <div class="page-stack">
        <n-card class="admin-card" :bordered="false">
          <div class="panel-header">
            <div>
              <h2>上游账号详情</h2>
              <p class="muted">最近心跳和故障恢复事件。</p>
            </div>
          </div>

          <div v-if="selectedAccount" class="detail-stack">
            <div class="detail-head">
              <span class="status-badge" :class="statusClass(selectedAccount.status)">
                {{ statusText(selectedAccount.status) }}
              </span>
              <div>
                <strong>{{ selectedAccount.accountName }}</strong>
              </div>
            </div>
            <div class="detail-grid">
              <span>最近检查</span><strong>{{ formatTime(selectedAccount.lastCheckAt) }}</strong>
              <span>最近可用</span><strong>{{ formatTime(selectedAccount.lastUpAt) }}</strong>
              <span>最近故障</span><strong>{{ formatTime(selectedAccount.lastDownAt) }}</strong>
              <span>7d 可用率</span><strong>{{ formatPercent(selectedAccount.uptime7d) }}</strong>
              <span>连续失败</span><strong>{{ selectedAccount.consecutiveFailCount }}</strong>
              <span>最近消息</span><strong>{{ selectedAccount.lastMessage || '-' }}</strong>
            </div>
            <div class="heartbeat-bars large">
              <span
                v-for="heartbeat in selectedAccount.heartbeats"
                :key="heartbeat.id"
                class="heartbeat-bar"
                :class="statusClass(heartbeat.status)"
                :title="`${statusText(heartbeat.status)} ${formatTime(heartbeat.checkedAt)} ${heartbeat.message || ''}`"
              ></span>
            </div>
            <div class="event-list">
              <div v-for="event in selectedAccount.events || []" :key="event.id" class="event-row">
                <span class="status-badge" :class="statusClass(event.status)">{{ statusText(event.status) }}</span>
                <div>
                  <strong>{{ formatTime(event.checkedAt) }}</strong>
                  <p class="muted">{{ event.message || '-' }}</p>
                </div>
              </div>
              <p v-if="!selectedAccount.events?.length" class="muted">暂无故障恢复事件。</p>
            </div>
          </div>
          <p v-else class="muted">请选择一个上游账号。</p>
        </n-card>

        <n-card class="admin-card" :bordered="false">
          <div class="panel-header">
            <div>
              <h2>监控设置</h2>
              <p class="muted">控制定时探测、重试、并发和通知。</p>
            </div>
          </div>
          <form class="form-grid single" @submit.prevent="saveSettings">
            <label class="check-row">
              <n-checkbox v-model:checked="settingsForm.enabled">启用定时监控</n-checkbox>
            </label>
            <label class="field">
              <span>检查间隔（秒）</span>
              <n-input-number v-model:value="settingsForm.intervalSec" :min="30" :step="30" />
            </label>
            <label class="field">
              <span>超时（秒）</span>
              <n-input-number v-model:value="settingsForm.timeoutSec" :min="1" :max="120" />
            </label>
            <label class="field">
              <span>最大重试</span>
              <n-input-number v-model:value="settingsForm.maxRetries" :min="0" :max="5" />
            </label>
            <label class="field">
              <span>并发数</span>
              <n-input-number v-model:value="settingsForm.concurrency" :min="1" :max="20" />
            </label>
            <label class="field">
              <span>历史保留天数</span>
              <n-input-number v-model:value="settingsForm.retentionDays" :min="1" :max="365" />
            </label>
            <label class="check-row">
              <n-checkbox v-model:checked="settingsForm.notifyOnDown">故障时通知</n-checkbox>
            </label>
            <label class="check-row">
              <n-checkbox v-model:checked="settingsForm.notifyOnRecovery">恢复时通知</n-checkbox>
            </label>
            <div class="form-actions">
              <n-button type="primary" attr-type="submit" :disabled="savingSettings">
                {{ savingSettings ? '保存中' : '保存设置' }}
              </n-button>
            </div>
          </form>
        </n-card>
      </div>
    </div>
  </section>
</template>

<style scoped lang="scss">
.monitor-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 16px;
}

.summary-card {
  display: flex;
  min-width: 140px;
  flex: 1;
  flex-direction: column;
  gap: 6px;
  border: 1px solid #d6dde8;
  border-radius: 8px;
  background: #ffffff;
  padding: 12px;
}

.summary-card span {
  color: #65748b;
  font-size: 13px;
}

.summary-card strong {
  color: #172033;
  font-size: 22px;
}

.monitor-layout {
  align-items: flex-start;
  grid-template-columns: minmax(0, 1.7fr) minmax(340px, 0.9fr);
}

.monitor-filters {
  display: flex;
  align-items: end;
  gap: 10px;
  margin: 16px 0;
}

.monitor-filters .field {
  flex: 1;
}

.admin-table tr.selected {
  background: #eef8fb;
}

.admin-table td small {
  display: block;
  max-width: 260px;
  overflow: hidden;
  color: #65748b;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-badge {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 3px 8px;
  font-size: 12px;
  font-weight: 700;
}

.status-up {
  background: #dcfce7;
  color: #166534;
}

.status-down {
  background: #fee2e2;
  color: #991b1b;
}

.status-pending {
  background: #fef3c7;
  color: #92400e;
}

.status-maintenance {
  background: #e2e8f0;
  color: #475569;
}

.heartbeat-bars {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 90px;
  min-height: 18px;
}

.heartbeat-bars.large {
  min-height: 34px;
  flex-wrap: wrap;
}

.heartbeat-bar {
  width: 5px;
  height: 18px;
  border-radius: 2px;
  background: #cbd5e1;
}

.heartbeat-bars.large .heartbeat-bar {
  width: 7px;
  height: 28px;
}

.row-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.detail-stack {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.detail-head {
  display: flex;
  align-items: center;
  gap: 12px;
}

.detail-head p {
  margin: 4px 0 0;
  word-break: break-all;
}

.detail-grid {
  display: grid;
  grid-template-columns: 90px minmax(0, 1fr);
  gap: 8px 12px;
  color: #65748b;
  font-size: 13px;
}

.detail-grid strong {
  color: #26364b;
  word-break: break-word;
}

.event-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.event-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  border-top: 1px solid #edf2f7;
  padding-top: 10px;
}

.event-row p {
  margin: 4px 0 0;
}

@media (max-width: 1080px) {
  .monitor-layout {
    grid-template-columns: 1fr;
  }

  .monitor-filters {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
