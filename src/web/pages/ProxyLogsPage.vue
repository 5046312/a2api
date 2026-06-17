<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useMessage } from 'naive-ui';
import { api, type Account, type DownstreamKey, type ProxyDebugTrace, type ProxyDebugTraceListItem, type ProxyLog } from '@web/api';

const PAGE_SIZE = 20;
const accounts = ref<Account[]>([]);
const downstreamKeys = ref<DownstreamKey[]>([]);
const logs = ref<ProxyLog[]>([]);
const traces = ref<ProxyDebugTraceListItem[]>([]);
const selectedLog = ref<ProxyLog | null>(null);
const selectedTrace = ref<ProxyDebugTrace | null>(null);
const detailDrawerVisible = ref(false);
const activeTab = ref<'proxyLogs' | 'debugTraces'>('proxyLogs');
const loading = ref(false);
const loadingDetailId = ref<number | null>(null);
const loadingTrace = ref(false);
const error = ref('');
const notice = useMessage();
const logsPage = ref(1);
const logsTotal = ref(0);
const tracesPage = ref(1);
const tracesTotal = ref(0);
const filters = reactive({
  requestId: '',
  status: '',
  model: '',
  accountId: '',
  downstreamApiKeyId: '',
  isStream: '',
  from: '',
  to: ''
});
const logStatusOptions = [
  { label: '全部状态', value: '' },
  { label: '请求中', value: 'pending' },
  { label: '成功', value: 'success' },
  { label: '失败', value: 'failed' },
  { label: '重试', value: 'retried' }
];
const streamOptions = [
  { label: '全部请求', value: '' },
  { label: '流式请求', value: 'true' },
  { label: '非流式请求', value: 'false' }
];
const logTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false
});
watch(error, (value) => {
  if (value) notice.error(value);
});
const accountOptions = computed(() => [
  { label: '全部上游账号', value: '' },
  ...accounts.value.map((account) => ({
    label: account.name || account.username || `上游账号 ${account.id}`,
    value: String(account.id)
  }))
]);
const downstreamKeyOptions = computed(() => [
  { label: '全部密钥', value: '' },
  ...downstreamKeys.value.map((key) => ({ label: key.name, value: String(key.id) }))
]);
const detailDrawerTitle = computed(() => {
  if (selectedLog.value) return `请求详情 #${selectedLog.value.requestId || selectedLog.value.debugTraceId || selectedLog.value.id}`;
  if (selectedTrace.value) return `Debug Trace #${selectedTrace.value.id}`;
  return '详情';
});

function setError(err: unknown, fallback: string) {
  error.value = err instanceof Error ? err.message : fallback;
}

function formatJson(value: unknown) {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

function formatMs(value: number | null) {
  return value === null ? '-' : `${value}ms`;
}

function formatId(value: number | null | undefined) {
  return value ? `#${value}` : '-';
}

function finalResultText() {
  if (!selectedLog.value) return '-';
  if (selectedLog.value.status === 'pending') return '请求进行中';
  if (selectedLog.value.status === 'success') return '请求最终成功';
  return selectedLog.value.errorMessage || '请求最终失败';
}

function formatAttemptRoute(attempt: ProxyDebugTrace['attempts'][number]) {
  return `${formatId(attempt.routeId)} / ${formatId(attempt.channelId)}`;
}

function formatAttemptAccount(attempt: ProxyDebugTrace['attempts'][number]) {
  const site = attempt.siteId ? `${formatId(attempt.siteId)}${attempt.sitePlatform ? ` (${attempt.sitePlatform})` : ''}` : '-';
  return `${formatId(attempt.accountId)} / ${site}`;
}

// 日志时间只展示月日和时分秒，列表里不重复显示年份。
function formatTime(value: string | null | undefined) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : logTimeFormatter.format(date);
}

function formatLogStatus(status: string | null | undefined, retryCount = 0) {
  if (!status) return '-';
  if (status === 'pending') return '请求中';
  if (status === 'success') {
    return retryCount > 0 ? `成功（重试 ${retryCount} 次）` : '成功';
  }
  if (status === 'failed') return '失败';
  if (status === 'retried') return '重试';
  return status;
}

// Trace 结束前 finalStatus 为空，这里统一按请求中展示。
function formatTraceStatus(status: string | null | undefined) {
  return status ? formatLogStatus(status) : '请求中';
}

function logStatusTagType(status: string) {
  if (status === 'pending') return 'info';
  if (status === 'success') return 'success';
  if (status === 'retried') return 'warning';
  if (status === 'failed') return 'error';
  return 'default';
}

function clearDetailSelection() {
  selectedLog.value = null;
  selectedTrace.value = null;
}

async function loadPage() {
  loading.value = true;
  error.value = '';
  try {
    const [accountData, keyData] = await Promise.all([
      api.listAccounts({ pageSize: 200 }),
      api.listDownstreamKeys()
    ]);
    accounts.value = accountData.items;
    downstreamKeys.value = keyData.items;
    await Promise.all([loadLogs(), loadTraces()]);
  } catch (err) {
    setError(err, '加载代理日志失败');
  } finally {
    loading.value = false;
  }
}

async function loadLogs() {
  loading.value = true;
  error.value = '';
  try {
    const data = await api.listProxyLogs({
      page: logsPage.value,
      pageSize: PAGE_SIZE,
      requestId: filters.requestId,
      status: filters.status,
      model: filters.model,
      accountId: filters.accountId,
      downstreamApiKeyId: filters.downstreamApiKeyId,
      isStream: filters.isStream || undefined,
      from: filters.from,
      to: filters.to
    });
    logs.value = data.items;
    logsTotal.value = data.total;
    selectedLog.value = null;
  } catch (err) {
    setError(err, '加载代理日志失败');
  } finally {
    loading.value = false;
  }
}

async function loadTraces() {
  loading.value = true;
  error.value = '';
  try {
    const data = await api.listProxyDebugTraces({
      page: tracesPage.value,
      pageSize: PAGE_SIZE,
      requestId: filters.requestId,
      requestedModel: filters.model,
      finalStatus: filters.status
    });
    traces.value = data.items;
    tracesTotal.value = data.total;
    selectedTrace.value = null;
  } catch (err) {
    setError(err, '加载 Trace 列表失败');
  } finally {
    loading.value = false;
  }
}

function reloadLogs() {
  logsPage.value = 1;
  return loadLogs();
}

function reloadTraces() {
  tracesPage.value = 1;
  return loadTraces();
}

async function reloadAll() {
  await Promise.all([reloadLogs(), reloadTraces()]);
}

async function handleLogsPageChange(page: number) {
  logsPage.value = page;
  await loadLogs();
}

async function handleTracesPageChange(page: number) {
  tracesPage.value = page;
  await loadTraces();
}

async function loadDetail(log: ProxyLog) {
  loadingDetailId.value = log.id;
  error.value = '';
  try {
    const detail = await api.getProxyLog(log.id);
    selectedLog.value = detail;
    selectedTrace.value = null;
    detailDrawerVisible.value = true;
    if (detail.debugTraceId) await loadTrace(detail.debugTraceId, true);
  } catch (err) {
    setError(err, '加载日志详情失败');
  } finally {
    loadingDetailId.value = null;
  }
}

async function loadTrace(id: number, keepLog = false) {
  loadingTrace.value = true;
  error.value = '';
  try {
    if (!keepLog) selectedLog.value = null;
    selectedTrace.value = await api.getProxyDebugTrace(id);
    detailDrawerVisible.value = true;
  } catch (err) {
    setError(err, '加载 Trace 失败');
  } finally {
    loadingTrace.value = false;
  }
}

onMounted(loadPage);
</script>

<template>
  <section class="page-stack">
    <n-card class="admin-card" :bordered="false">
      <div class="toolbar">
        <n-select v-model:value="filters.status" :options="logStatusOptions" class="toolbar-select" @update:value="reloadAll" />
        <n-select v-model:value="filters.accountId" :options="accountOptions" class="toolbar-select" @update:value="reloadAll" />
        <n-select
          v-model:value="filters.downstreamApiKeyId"
          :options="downstreamKeyOptions"
          class="toolbar-select"
          @update:value="reloadAll"
        />
        <n-input v-model:value="filters.requestId" placeholder="请求 ID" @keyup.enter="reloadAll" />
        <n-input v-model:value="filters.model" placeholder="模型关键字" @keyup.enter="reloadAll" />
        <n-select v-model:value="filters.isStream" :options="streamOptions" class="toolbar-select" @update:value="reloadAll" />
        <n-input v-model:value="filters.from" placeholder="起始 ISO 时间" @keyup.enter="reloadAll" />
        <n-input v-model:value="filters.to" placeholder="结束 ISO 时间" @keyup.enter="reloadAll" />
      </div>
      <n-tabs v-model:value="activeTab" type="line" animated>
        <n-tab-pane name="proxyLogs" tab="代理日志">
          <div class="panel-header">
            <div>
              <h2>代理日志</h2>
              <p class="muted">查看 `/v1/*` 请求模型选择结果和错误。</p>
            </div>
            <n-button secondary attr-type="button" @click="loadLogs">刷新</n-button>
          </div>
          <div class="table-wrap">
            <n-table size="small" :bordered="false" single-line class="admin-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>请求 ID</th>
                  <th>状态</th>
                  <th>HTTP</th>
                  <th>路径</th>
                  <th>请求模型</th>
                  <th>实际模型</th>
                  <th>上游账号</th>
                  <th>密钥</th>
                  <th>流式</th>
                  <th>耗时</th>
                  <th>用量</th>
                  <th>费用</th>
                  <th>错误</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="log in logs" :key="log.id">
                  <td class="mono">{{ formatTime(log.createdAt) }}</td>
                  <td class="mono">{{ formatId(log.requestId || log.debugTraceId) }}</td>
                  <td><n-tag size="small" :type="logStatusTagType(log.status)">{{ formatLogStatus(log.status, log.retryCount) }}</n-tag></td>
                  <td>{{ log.httpStatus || '-' }}</td>
                  <td class="mono">{{ log.downstreamPath || '-' }}</td>
                  <td class="mono">{{ log.modelRequested || '-' }}</td>
                  <td class="mono">{{ log.modelActual || '-' }}</td>
                  <td>{{ log.accountName || (log.accountId ? `#${log.accountId}` : '-') }}</td>
                  <td>{{ log.downstreamKeyName || (log.downstreamApiKeyId ? `#${log.downstreamApiKeyId}` : '-') }}</td>
                  <td>{{ log.isStream ? '是' : '否' }}</td>
                  <td>{{ log.latencyMs === null ? '-' : `${log.latencyMs}ms` }}</td>
                  <td>{{ log.totalTokens }}</td>
                  <td>{{ log.estimatedCost.toFixed(6) }}</td>
                  <td class="error-cell">{{ log.errorMessage || '-' }}</td>
                  <td>
                    <n-button text attr-type="button" :disabled="loadingDetailId === log.id" @click="loadDetail(log)">
                      {{ loadingDetailId === log.id ? '加载中' : '详情' }}
                    </n-button>
                  </td>
                </tr>
                <tr v-if="!loading && logs.length === 0">
                  <td class="empty" colspan="15">暂无日志</td>
                </tr>
              </tbody>
            </n-table>
          </div>
          <div class="pagination-wrap">
            <n-pagination
              :page="logsPage"
              :page-size="PAGE_SIZE"
              :item-count="logsTotal"
              @update:page="handleLogsPageChange"
            />
          </div>
        </n-tab-pane>

        <n-tab-pane name="debugTraces" tab="Debug Trace">
          <div class="panel-header">
            <div>
              <h2>Debug Trace</h2>
              <p class="muted">独立查看代理尝试、上游状态和失败原因。</p>
            </div>
            <n-button secondary attr-type="button" @click="loadTraces">刷新 Trace</n-button>
          </div>
          <div class="table-wrap">
            <n-table size="small" :bordered="false" single-line class="admin-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>请求 ID</th>
                  <th>路径</th>
                  <th>模型</th>
                  <th>状态</th>
                  <th>HTTP</th>
                  <th>路由</th>
                  <th>尝试</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="trace in traces" :key="trace.id">
                  <td class="mono">{{ formatTime(trace.createdAt) }}</td>
                  <td class="mono">{{ formatId(trace.requestId) }}</td>
                  <td class="mono">{{ trace.downstreamPath }}</td>
                  <td class="mono">{{ trace.requestedModel || '-' }}</td>
                  <td>{{ formatTraceStatus(trace.finalStatus) }}</td>
                  <td>{{ trace.finalHttpStatus || '-' }}</td>
                  <td>{{ trace.selectedRouteId || '-' }}</td>
                  <td>{{ trace.attemptCount }}</td>
                  <td>
                    <n-button text attr-type="button" :disabled="loadingTrace" @click="loadTrace(trace.id)">详情</n-button>
                  </td>
                </tr>
                <tr v-if="!loading && traces.length === 0">
                  <td class="empty" colspan="9">暂无 Trace</td>
                </tr>
              </tbody>
            </n-table>
          </div>
          <div class="pagination-wrap">
            <n-pagination
              :page="tracesPage"
              :page-size="PAGE_SIZE"
              :item-count="tracesTotal"
              @update:page="handleTracesPageChange"
            />
          </div>
        </n-tab-pane>
      </n-tabs>
    </n-card>

    <n-drawer
      v-model:show="detailDrawerVisible"
      placement="right"
      width="min(1080px, calc(100vw - 24px))"
      @after-leave="clearDetailSelection"
    >
      <n-drawer-content :title="detailDrawerTitle">
        <div class="page-stack">
          <n-card class="admin-card" :bordered="false" v-if="selectedLog">
            <div class="panel-header">
              <div>
                <h2>请求详情 {{ formatId(selectedLog.requestId || selectedLog.debugTraceId) }}</h2>
                <p class="muted">{{ selectedLog.downstreamPath || '-' }} · {{ selectedLog.modelRequested || '-' }} -> {{ selectedLog.modelActual || '-' }}</p>
              </div>
            </div>
            <h3 class="detail-section-title">基本信息</h3>
            <div class="table-wrap">
              <n-table size="small" :bordered="false" single-line class="admin-table">
                <tbody>
                  <tr>
                    <th>请求 ID</th>
                    <td class="mono">{{ formatId(selectedLog.requestId || selectedLog.debugTraceId) }}</td>
                    <th>时间</th>
                    <td class="mono">{{ formatTime(selectedLog.createdAt) }}</td>
                  </tr>
                  <tr>
                    <th>路径</th>
                    <td class="mono">{{ selectedLog.downstreamPath || '-' }}</td>
                    <th>流式</th>
                    <td>{{ selectedLog.isStream ? '是' : '否' }}</td>
                  </tr>
                  <tr>
                    <th>请求模型</th>
                    <td class="mono">{{ selectedLog.modelRequested || '-' }}</td>
                    <th>实际模型</th>
                    <td class="mono">{{ selectedLog.modelActual || '-' }}</td>
                  </tr>
                  <tr>
                    <th>密钥</th>
                    <td>{{ selectedLog.downstreamKeyName || (selectedLog.downstreamApiKeyId ? `#${selectedLog.downstreamApiKeyId}` : '-') }}</td>
                    <th>尝试次数</th>
                    <td>{{ selectedTrace?.attempts.length ?? selectedLog.retryCount + 1 }}</td>
                  </tr>
                  <tr>
                    <th>输入 / 输出</th>
                    <td>{{ selectedLog.promptTokens }} / {{ selectedLog.completionTokens }}</td>
                    <th>缓存读 / 写</th>
                    <td>{{ selectedLog.cacheReadTokens }} / {{ selectedLog.cacheWriteTokens }}</td>
                  </tr>
                  <tr>
                    <th>首字节 / 总耗时</th>
                    <td>{{ formatMs(selectedLog.firstByteLatencyMs) }} / {{ formatMs(selectedLog.latencyMs) }}</td>
                    <th>费用</th>
                    <td>{{ selectedLog.estimatedCost.toFixed(6) }}</td>
                  </tr>
                </tbody>
              </n-table>
            </div>

            <h3 class="detail-section-title">最终结果</h3>
            <div class="table-wrap">
              <n-table size="small" :bordered="false" single-line class="admin-table">
                <tbody>
                  <tr>
                    <th>状态 / HTTP</th>
                    <td>{{ formatLogStatus(selectedLog.status, selectedLog.retryCount) }} / {{ selectedLog.httpStatus || '-' }}</td>
                    <th>结果说明</th>
                    <td class="error-cell">{{ finalResultText() }}</td>
                  </tr>
                  <tr>
                    <th>最终路由 / 通道</th>
                    <td>{{ formatId(selectedLog.routeId) }} / {{ formatId(selectedLog.channelId) }}</td>
                    <th>最终上游账号</th>
                    <td>{{ selectedLog.accountName || formatId(selectedLog.accountId) }}</td>
                  </tr>
                  <tr>
                    <th>最终站点</th>
                    <td>{{ selectedLog.siteName || formatId(selectedLog.siteId) }}</td>
                    <th>最终上游地址</th>
                    <td class="mono">{{ selectedTrace?.finalUpstreamPath || '-' }}</td>
                  </tr>
                  <tr>
                    <th>Billing</th>
                    <td colspan="3"><pre class="mono">{{ formatJson(selectedLog.billingDetails) }}</pre></td>
                  </tr>
                </tbody>
              </n-table>
            </div>
          </n-card>

          <n-card class="admin-card" :bordered="false" v-if="selectedTrace">
            <div class="panel-header">
              <div>
                <h2>{{ selectedLog ? '尝试列表' : `Debug Trace #${selectedTrace.id}` }}</h2>
                <p class="muted">{{ formatTraceStatus(selectedTrace.finalStatus) }} / {{ selectedTrace.finalHttpStatus || '-' }}</p>
              </div>
            </div>
            <div class="table-wrap">
              <n-table size="small" :bordered="false" single-line class="admin-table">
                <thead>
                  <tr>
                    <th>尝试</th>
                    <th>路由 / 通道</th>
                    <th>账号 / 站点</th>
                    <th>实际模型</th>
                    <th>Endpoint</th>
                    <th>目标</th>
                    <th>状态</th>
                    <th>错误</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="attempt in selectedTrace.attempts" :key="attempt.id">
                    <td>{{ attempt.attemptIndex }}</td>
                    <td>{{ formatAttemptRoute(attempt) }}</td>
                    <td>{{ formatAttemptAccount(attempt) }}</td>
                    <td class="mono">{{ attempt.modelActual || '-' }}</td>
                    <td>{{ attempt.endpoint }}</td>
                    <td class="mono">{{ attempt.targetUrl }}</td>
                    <td>{{ attempt.responseStatus || '-' }}</td>
                    <td class="error-cell">{{ attempt.rawErrorText || '-' }}</td>
                  </tr>
                  <tr v-if="selectedTrace.attempts.length === 0">
                    <td class="empty" colspan="8">暂无尝试记录</td>
                  </tr>
                </tbody>
              </n-table>
            </div>
          </n-card>
        </div>
      </n-drawer-content>
    </n-drawer>
  </section>
</template>

<style scoped lang="scss">
.pagination-wrap {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}

.detail-section-title {
  margin: 18px 0 10px;
  font-size: 15px;
  font-weight: 700;
}
</style>
