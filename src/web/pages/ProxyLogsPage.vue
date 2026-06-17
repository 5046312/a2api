<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useMessage } from 'naive-ui';
import { api, type Account, type DownstreamKey, type ProxyDebugTrace, type ProxyLog } from '@web/api';

const accounts = ref<Account[]>([]);
const downstreamKeys = ref<DownstreamKey[]>([]);
const logs = ref<ProxyLog[]>([]);
const traces = ref<Array<Omit<ProxyDebugTrace, 'attempts' | 'requestHeaders' | 'decisionSummary' | 'finalResponseHeaders'> & { attemptCount: number }>>([]);
const selectedLog = ref<ProxyLog | null>(null);
const selectedTrace = ref<ProxyDebugTrace | null>(null);
const loading = ref(false);
const loadingDetailId = ref<number | null>(null);
const loadingTrace = ref(false);
const error = ref('');
const notice = useMessage();
const filters = reactive({
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
  { label: '成功', value: 'success' },
  { label: '失败', value: 'failed' },
  { label: '重试', value: 'retried' }
];
const streamOptions = [
  { label: '全部请求', value: '' },
  { label: '流式请求', value: 'true' },
  { label: '非流式请求', value: 'false' }
];
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
  { label: '全部下游 Key', value: '' },
  ...downstreamKeys.value.map((key) => ({ label: key.name, value: String(key.id) }))
]);

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

function logStatusTagType(status: string) {
  if (status === 'success') return 'success';
  if (status === 'retried') return 'warning';
  if (status === 'failed') return 'error';
  return 'default';
}

async function loadPage() {
  loading.value = true;
  error.value = '';
  try {
    const [accountData, keyData, logData, traceData] = await Promise.all([
      api.listAccounts({ pageSize: 200 }),
      api.listDownstreamKeys(),
      api.listProxyLogs({ pageSize: 50 }),
      api.listProxyDebugTraces({ limit: 50 })
    ]);
    accounts.value = accountData.items;
    downstreamKeys.value = keyData.items;
    logs.value = logData.items;
    traces.value = traceData.items;
    selectedLog.value = null;
    selectedTrace.value = null;
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
      status: filters.status,
      model: filters.model,
      accountId: filters.accountId,
      downstreamApiKeyId: filters.downstreamApiKeyId,
      isStream: filters.isStream || undefined,
      from: filters.from,
      to: filters.to,
      pageSize: 50
    });
    logs.value = data.items;
    selectedLog.value = null;
    selectedTrace.value = null;
    await loadTraces();
  } catch (err) {
    setError(err, '加载代理日志失败');
  } finally {
    loading.value = false;
  }
}

async function loadTraces() {
  try {
    const data = await api.listProxyDebugTraces({
      requestedModel: filters.model,
      finalStatus: filters.status,
      limit: 50
    });
    traces.value = data.items;
  } catch (err) {
    setError(err, '加载 Trace 列表失败');
  }
}

async function loadDetail(log: ProxyLog) {
  loadingDetailId.value = log.id;
  error.value = '';
  try {
    selectedLog.value = await api.getProxyLog(log.id);
    selectedTrace.value = null;
  } catch (err) {
    setError(err, '加载日志详情失败');
  } finally {
    loadingDetailId.value = null;
  }
}

async function loadTrace(id: number) {
  loadingTrace.value = true;
  error.value = '';
  try {
    selectedTrace.value = await api.getProxyDebugTrace(id);
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
      <div class="panel-header">
        <div>
          <h2>代理日志</h2>
          <p class="muted">查看 `/v1/*` 请求模型选择结果和错误。</p>
        </div>
        <n-button secondary attr-type="button" @click="loadLogs">刷新</n-button>
      </div>
      <div class="toolbar">
        <n-select v-model:value="filters.status" :options="logStatusOptions" class="toolbar-select" @update:value="loadLogs" />
        <n-select v-model:value="filters.accountId" :options="accountOptions" class="toolbar-select" @update:value="loadLogs" />
        <n-select
          v-model:value="filters.downstreamApiKeyId"
          :options="downstreamKeyOptions"
          class="toolbar-select"
          @update:value="loadLogs"
        />
        <n-input v-model:value="filters.model" placeholder="模型关键字" @keyup.enter="loadLogs" />
        <n-select v-model:value="filters.isStream" :options="streamOptions" class="toolbar-select" @update:value="loadLogs" />
        <n-input v-model:value="filters.from" placeholder="起始 ISO 时间" @keyup.enter="loadLogs" />
        <n-input v-model:value="filters.to" placeholder="结束 ISO 时间" @keyup.enter="loadLogs" />
      </div>
      <div class="table-wrap">
        <n-table size="small" :bordered="false" single-line class="admin-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>状态</th>
              <th>HTTP</th>
              <th>请求模型</th>
              <th>实际模型</th>
              <th>上游账号</th>
              <th>通道</th>
              <th>下游 Key</th>
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
              <td class="mono">{{ log.createdAt }}</td>
              <td><n-tag size="small" :type="logStatusTagType(log.status)">{{ log.status }}</n-tag></td>
              <td>{{ log.httpStatus || '-' }}</td>
              <td class="mono">{{ log.modelRequested || '-' }}</td>
              <td class="mono">{{ log.modelActual || '-' }}</td>
              <td>{{ log.accountName || (log.accountId ? `#${log.accountId}` : '-') }}</td>
              <td>{{ log.channelId || '-' }}</td>
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
              <td class="empty" colspan="14">暂无日志</td>
            </tr>
          </tbody>
        </n-table>
      </div>
    </n-card>

    <n-card class="admin-card" :bordered="false">
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
              <th>路径</th>
              <th>模型</th>
              <th>状态</th>
              <th>HTTP</th>
              <th>模型</th>
              <th>通道</th>
              <th>尝试</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="trace in traces" :key="trace.id">
              <td class="mono">{{ trace.createdAt }}</td>
              <td class="mono">{{ trace.downstreamPath }}</td>
              <td class="mono">{{ trace.requestedModel || '-' }}</td>
              <td>{{ trace.finalStatus || '-' }}</td>
              <td>{{ trace.finalHttpStatus || '-' }}</td>
              <td>{{ trace.selectedRouteId || '-' }}</td>
              <td>{{ trace.selectedChannelId || '-' }}</td>
              <td>{{ trace.attemptCount }}</td>
              <td>
                <n-button text attr-type="button" :disabled="loadingTrace" @click="loadTrace(trace.id)">详情</n-button>
              </td>
            </tr>
            <tr v-if="traces.length === 0">
              <td class="empty" colspan="9">暂无 Trace</td>
            </tr>
          </tbody>
        </n-table>
      </div>
    </n-card>

    <n-card class="admin-card" :bordered="false" v-if="selectedLog">
      <div class="panel-header">
        <div>
          <h2>日志详情 #{{ selectedLog.id }}</h2>
          <p class="muted">{{ selectedLog.modelRequested || '-' }} -> {{ selectedLog.modelActual || '-' }}</p>
        </div>
      </div>
      <div class="table-wrap">
        <n-table size="small" :bordered="false" single-line class="admin-table">
          <tbody>
            <tr>
              <th>时间</th>
              <td class="mono">{{ selectedLog.createdAt }}</td>
              <th>模型 / 通道</th>
              <td>{{ selectedLog.routeId || '-' }} / {{ selectedLog.channelId || '-' }}</td>
            </tr>
            <tr>
              <th>上游账号</th>
              <td colspan="3">{{ selectedLog.accountName || (selectedLog.accountId ? `#${selectedLog.accountId}` : '-') }}</td>
            </tr>
            <tr>
              <th>下游 Key</th>
              <td>{{ selectedLog.downstreamKeyName || (selectedLog.downstreamApiKeyId ? `#${selectedLog.downstreamApiKeyId}` : '-') }}</td>
              <th>重试次数</th>
              <td>{{ selectedLog.retryCount }}</td>
            </tr>
            <tr>
              <th>Trace</th>
              <td colspan="3">
                <n-button text
                  v-if="selectedLog.debugTraceId"
                  attr-type="button"
                  :disabled="loadingTrace"
                  @click="loadTrace(selectedLog.debugTraceId)"
                >
                  {{ loadingTrace ? '加载中' : `查看 Trace #${selectedLog.debugTraceId}` }}
                </n-button>
                <span v-else>-</span>
              </td>
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
            <tr>
              <th>错误</th>
              <td colspan="3" class="error-cell">{{ selectedLog.errorMessage || '-' }}</td>
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
          <h2>Debug Trace #{{ selectedTrace.id }}</h2>
          <p class="muted">{{ selectedTrace.finalStatus || '-' }} / {{ selectedTrace.finalHttpStatus || '-' }}</p>
        </div>
      </div>
      <div class="table-wrap">
        <n-table size="small" :bordered="false" single-line class="admin-table">
          <thead>
            <tr>
              <th>尝试</th>
              <th>Endpoint</th>
              <th>目标</th>
              <th>状态</th>
              <th>错误</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="attempt in selectedTrace.attempts" :key="attempt.id">
              <td>{{ attempt.attemptIndex }}</td>
              <td>{{ attempt.endpoint }}</td>
              <td class="mono">{{ attempt.targetUrl }}</td>
              <td>{{ attempt.responseStatus || '-' }}</td>
              <td class="error-cell">{{ attempt.rawErrorText || '-' }}</td>
            </tr>
            <tr v-if="selectedTrace.attempts.length === 0">
              <td class="empty" colspan="5">暂无尝试记录</td>
            </tr>
          </tbody>
        </n-table>
      </div>
    </n-card>
  </section>
</template>
