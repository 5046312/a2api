<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { api, type Account, type DownstreamKey, type ProxyDebugTrace, type ProxyLog, type Site } from '@web/api';

const sites = ref<Site[]>([]);
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
const filters = reactive({
  status: '',
  model: '',
  siteId: '',
  accountId: '',
  downstreamApiKeyId: '',
  isStream: '',
  from: '',
  to: ''
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

async function loadPage() {
  loading.value = true;
  error.value = '';
  try {
    const [siteData, accountData, keyData, logData, traceData] = await Promise.all([
      api.listSites({ pageSize: 200 }),
      api.listAccounts({ pageSize: 200 }),
      api.listDownstreamKeys(),
      api.listProxyLogs({ pageSize: 50 }),
      api.listProxyDebugTraces({ limit: 50 })
    ]);
    sites.value = siteData.items;
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
      siteId: filters.siteId,
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
    <div class="panel">
      <div class="panel-header">
        <div>
          <h2>代理日志</h2>
          <p class="muted">查看 `/v1/*` 请求路由结果和错误。</p>
        </div>
        <button class="btn btn-secondary" type="button" @click="loadLogs">刷新</button>
      </div>
      <div class="toolbar">
        <select v-model="filters.status" class="select" @change="loadLogs">
          <option value="">全部状态</option>
          <option value="success">成功</option>
          <option value="failed">失败</option>
          <option value="retried">重试</option>
        </select>
        <select v-model="filters.siteId" class="select" @change="loadLogs">
          <option value="">全部站点</option>
          <option v-for="site in sites" :key="site.id" :value="site.id">{{ site.name }}</option>
        </select>
        <select v-model="filters.accountId" class="select" @change="loadLogs">
          <option value="">全部账号</option>
          <option v-for="account in accounts" :key="account.id" :value="account.id">
            {{ account.siteName || '-' }} / {{ account.username || `#${account.id}` }}
          </option>
        </select>
        <select v-model="filters.downstreamApiKeyId" class="select" @change="loadLogs">
          <option value="">全部下游 Key</option>
          <option v-for="key in downstreamKeys" :key="key.id" :value="key.id">{{ key.name }}</option>
        </select>
        <input v-model="filters.model" class="input" placeholder="模型关键字" @keyup.enter="loadLogs" />
        <select v-model="filters.isStream" class="select" @change="loadLogs">
          <option value="">全部请求</option>
          <option value="true">流式请求</option>
          <option value="false">非流式请求</option>
        </select>
        <input v-model="filters.from" class="input" placeholder="起始 ISO 时间" @keyup.enter="loadLogs" />
        <input v-model="filters.to" class="input" placeholder="结束 ISO 时间" @keyup.enter="loadLogs" />
      </div>
      <p v-if="error" class="error">{{ error }}</p>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>状态</th>
              <th>HTTP</th>
              <th>请求模型</th>
              <th>实际模型</th>
              <th>站点</th>
              <th>账号</th>
              <th>通道</th>
              <th>下游 Key</th>
              <th>流式</th>
              <th>耗时</th>
              <th>Token</th>
              <th>费用</th>
              <th>错误</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="log in logs" :key="log.id">
              <td class="mono">{{ log.createdAt }}</td>
              <td><span class="badge" :class="log.status">{{ log.status }}</span></td>
              <td>{{ log.httpStatus || '-' }}</td>
              <td class="mono">{{ log.modelRequested || '-' }}</td>
              <td class="mono">{{ log.modelActual || '-' }}</td>
              <td>{{ log.siteName || '-' }}</td>
              <td>{{ log.accountName || (log.accountId ? `#${log.accountId}` : '-') }}</td>
              <td>{{ log.channelId || '-' }}</td>
              <td>{{ log.downstreamKeyName || (log.downstreamApiKeyId ? `#${log.downstreamApiKeyId}` : '-') }}</td>
              <td>{{ log.isStream ? '是' : '否' }}</td>
              <td>{{ log.latencyMs === null ? '-' : `${log.latencyMs}ms` }}</td>
              <td>{{ log.totalTokens }}</td>
              <td>{{ log.estimatedCost.toFixed(6) }}</td>
              <td class="error-cell">{{ log.errorMessage || '-' }}</td>
              <td>
                <button class="text-btn" type="button" :disabled="loadingDetailId === log.id" @click="loadDetail(log)">
                  {{ loadingDetailId === log.id ? '加载中' : '详情' }}
                </button>
              </td>
            </tr>
            <tr v-if="!loading && logs.length === 0">
              <td class="empty" colspan="15">暂无日志</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header">
        <div>
          <h2>Debug Trace</h2>
          <p class="muted">独立查看代理尝试、上游状态和失败原因。</p>
        </div>
        <button class="btn btn-secondary" type="button" @click="loadTraces">刷新 Trace</button>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>路径</th>
              <th>模型</th>
              <th>状态</th>
              <th>HTTP</th>
              <th>路由</th>
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
                <button class="text-btn" type="button" :disabled="loadingTrace" @click="loadTrace(trace.id)">详情</button>
              </td>
            </tr>
            <tr v-if="traces.length === 0">
              <td class="empty" colspan="9">暂无 Trace</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div v-if="selectedLog" class="panel">
      <div class="panel-header">
        <div>
          <h2>日志详情 #{{ selectedLog.id }}</h2>
          <p class="muted">{{ selectedLog.modelRequested || '-' }} -> {{ selectedLog.modelActual || '-' }}</p>
        </div>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <tbody>
            <tr>
              <th>时间</th>
              <td class="mono">{{ selectedLog.createdAt }}</td>
              <th>路由 / 通道</th>
              <td>{{ selectedLog.routeId || '-' }} / {{ selectedLog.channelId || '-' }}</td>
            </tr>
            <tr>
              <th>站点</th>
              <td>{{ selectedLog.siteName || '-' }}</td>
              <th>账号</th>
              <td>{{ selectedLog.accountName || (selectedLog.accountId ? `#${selectedLog.accountId}` : '-') }}</td>
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
                <button
                  v-if="selectedLog.debugTraceId"
                  class="text-btn"
                  type="button"
                  :disabled="loadingTrace"
                  @click="loadTrace(selectedLog.debugTraceId)"
                >
                  {{ loadingTrace ? '加载中' : `查看 Trace #${selectedLog.debugTraceId}` }}
                </button>
                <span v-else>-</span>
              </td>
            </tr>
            <tr>
              <th>Prompt / Completion</th>
              <td>{{ selectedLog.promptTokens }} / {{ selectedLog.completionTokens }}</td>
              <th>Cache Read / Write</th>
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
        </table>
      </div>
    </div>

    <div v-if="selectedTrace" class="panel">
      <div class="panel-header">
        <div>
          <h2>Debug Trace #{{ selectedTrace.id }}</h2>
          <p class="muted">{{ selectedTrace.finalStatus || '-' }} / {{ selectedTrace.finalHttpStatus || '-' }}</p>
        </div>
      </div>
      <div class="table-wrap">
        <table class="data-table">
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
        </table>
      </div>
    </div>
  </section>
</template>
