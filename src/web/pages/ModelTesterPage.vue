<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import {
  api,
  type DownstreamKey,
  type ProxyDebugTrace,
  type RouteChannel,
  type RouteDecision,
  type RouteItem,
  type StatsMarketplaceItem,
  type TestChatPayload,
  type TestChatResult
} from '@web/api';

const models = ref<StatsMarketplaceItem[]>([]);
const routes = ref<RouteItem[]>([]);
const channels = ref<RouteChannel[]>([]);
const downstreamKeys = ref<DownstreamKey[]>([]);
const decision = ref<RouteDecision | null>(null);
const result = ref<TestChatResult | null>(null);
const selectedTrace = ref<ProxyDebugTrace | null>(null);
const loading = ref(false);
const sending = ref(false);
const loadingTrace = ref(false);
const error = ref('');
const message = ref('');
const form = reactive({
  model: '',
  downstreamApiKeyId: '',
  forcedChannelId: '',
  system: '',
  prompt: 'hello',
  temperature: ''
});

const modelOptions = computed(() => {
  const names = new Set<string>();
  models.value.forEach((item) => names.add(item.model));
  routes.value.forEach((route) => {
    if (!route.modelPattern.includes('*') && !route.modelPattern.startsWith('re:')) names.add(route.modelPattern);
    if (route.displayName) names.add(route.displayName);
  });
  return Array.from(names).sort((left, right) => left.localeCompare(right));
});

const selectedRoute = computed(() => {
  const model = form.model.trim();
  if (!model) return null;
  return routes.value.find((route) => route.modelPattern === model || route.displayName === model) || null;
});

const responseText = computed(() => result.value ? JSON.stringify(result.value, null, 2) : '');
const responseTraceId = computed(() => {
  const value = result.value?.a2apiDebugTraceId;
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
});

function positiveId(value: string): number | undefined {
  const id = Number(value);
  return value !== '' && Number.isInteger(id) && id > 0 ? id : undefined;
}

function setError(err: unknown, fallback: string) {
  error.value = err instanceof Error ? err.message : fallback;
}

function formatJson(value: unknown) {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

function buildMessages() {
  const messages: Array<{ role: string; content: string }> = [];
  const system = form.system.trim();
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: form.prompt.trim() || 'hello' });
  return messages;
}

function buildPayload(): TestChatPayload {
  const payload: TestChatPayload = {
    model: form.model.trim(),
    messages: buildMessages(),
    stream: false
  };
  const temperature = Number(form.temperature);
  if (form.temperature !== '' && Number.isFinite(temperature)) payload.temperature = temperature;
  const downstreamApiKeyId = positiveId(form.downstreamApiKeyId);
  const forcedChannelId = positiveId(form.forcedChannelId);
  if (downstreamApiKeyId) payload.downstreamApiKeyId = downstreamApiKeyId;
  if (forcedChannelId) payload.forcedChannelId = forcedChannelId;
  return payload;
}

function buildDecisionOptions(): { downstreamApiKeyId?: number; forcedChannelId?: number } {
  const options: { downstreamApiKeyId?: number; forcedChannelId?: number } = {};
  const downstreamApiKeyId = positiveId(form.downstreamApiKeyId);
  const forcedChannelId = positiveId(form.forcedChannelId);
  if (downstreamApiKeyId) options.downstreamApiKeyId = downstreamApiKeyId;
  if (forcedChannelId) options.forcedChannelId = forcedChannelId;
  return options;
}

async function loadChannelsForSelectedRoute() {
  channels.value = [];
  form.forcedChannelId = '';
  const route = selectedRoute.value;
  if (!route) return;
  const data = await api.listRouteChannels(route.id);
  channels.value = data.items;
}

async function loadData() {
  loading.value = true;
  error.value = '';
  try {
    const [marketplaceData, routeData, keyData] = await Promise.all([
      api.getStatsMarketplace(),
      api.listRoutes(),
      api.listDownstreamKeys()
    ]);
    models.value = marketplaceData.items;
    routes.value = routeData.items;
    downstreamKeys.value = keyData.items;
    if (!form.model && modelOptions.value.length > 0) form.model = modelOptions.value[0] || '';
    await loadChannelsForSelectedRoute();
  } catch (err) {
    setError(err, '加载模型列表失败');
  } finally {
    loading.value = false;
  }
}

async function explainSelectedRoute() {
  decision.value = null;
  const route = selectedRoute.value;
  if (!route) return;
  try {
    decision.value = await api.explainRouteDecision(route.id, form.model.trim(), buildDecisionOptions());
  } catch (err) {
    setError(err, '加载路由解释失败');
  }
}

async function handleModelChange() {
  error.value = '';
  try {
    await loadChannelsForSelectedRoute();
  } catch (err) {
    setError(err, '加载通道失败');
    return;
  }
  await explainSelectedRoute();
}

async function sendTest() {
  if (!form.model.trim()) return;
  sending.value = true;
  error.value = '';
  message.value = '';
  result.value = null;
  selectedTrace.value = null;
  try {
    result.value = await api.testChat(buildPayload());
    message.value = '测试请求完成';
    if (responseTraceId.value) await loadTrace(responseTraceId.value);
    await explainSelectedRoute();
  } catch (err) {
    setError(err, '测试请求失败');
  } finally {
    sending.value = false;
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

onMounted(loadData);
</script>

<template>
  <section class="page-stack">
    <div class="panel">
      <div class="panel-header">
        <div>
          <h2>模型操练场</h2>
          <p class="muted">复用管理端测试入口，当前支持非流式 Chat。</p>
        </div>
        <button class="btn btn-secondary" type="button" :disabled="loading" @click="loadData">
          {{ loading ? '刷新中' : '刷新模型' }}
        </button>
      </div>
      <p v-if="message" class="notice">{{ message }}</p>
      <p v-if="error" class="error">{{ error }}</p>
      <form class="form-grid" @submit.prevent="sendTest">
        <label class="field">
          <span>模型</span>
          <select v-model="form.model" class="select" required @change="handleModelChange">
            <option v-for="model in modelOptions" :key="model" :value="model">{{ model }}</option>
          </select>
        </label>
        <label class="field">
          <span>下游 Key</span>
          <select v-model="form.downstreamApiKeyId" class="select" @change="explainSelectedRoute">
            <option value="">全局策略</option>
            <option v-for="key in downstreamKeys" :key="key.id" :value="String(key.id)">
              {{ key.name }} / {{ key.keyMasked }}{{ key.enabled ? '' : ' / 停用' }}
            </option>
          </select>
        </label>
        <label class="field">
          <span>Temperature</span>
          <input v-model="form.temperature" class="input" min="0" max="2" step="0.1" type="number" placeholder="默认" />
        </label>
        <label class="field">
          <span>路由</span>
          <input class="input" :value="selectedRoute ? selectedRoute.modelPattern : '自动匹配'" disabled />
        </label>
        <label class="field">
          <span>强制通道</span>
          <select v-model="form.forcedChannelId" class="select" :disabled="channels.length === 0" @change="explainSelectedRoute">
            <option value="">自动选择</option>
            <option v-for="channel in channels" :key="channel.id" :value="String(channel.id)">
              #{{ channel.id }} / {{ channel.siteName || '-' }} / {{ channel.accountName || channel.accountId }}
            </option>
          </select>
        </label>
        <label class="field wide">
          <span>System</span>
          <textarea v-model="form.system" class="textarea" placeholder="可选"></textarea>
        </label>
        <label class="field wide">
          <span>Prompt</span>
          <textarea v-model="form.prompt" class="textarea" required></textarea>
        </label>
        <div class="form-actions wide">
          <button class="btn btn-primary" type="submit" :disabled="sending || !form.model">
            {{ sending ? '请求中' : '发送测试' }}
          </button>
          <button class="btn btn-secondary" type="button" :disabled="!selectedRoute" @click="explainSelectedRoute">解释路由</button>
        </div>
      </form>
    </div>

    <div class="two-column">
      <div class="panel">
        <div class="panel-header">
          <div>
            <h2>响应</h2>
            <p class="muted">返回上游 JSON，便于核对模型和 usage。</p>
          </div>
          <button
            v-if="responseTraceId"
            class="btn btn-secondary"
            type="button"
            :disabled="loadingTrace"
            @click="loadTrace(responseTraceId)"
          >
            {{ loadingTrace ? '加载中' : `Trace #${responseTraceId}` }}
          </button>
        </div>
        <textarea class="textarea mono" readonly :value="responseText" placeholder="发送测试后显示响应"></textarea>
      </div>

      <div class="panel">
        <div class="panel-header">
          <div>
            <h2>路由解释</h2>
            <p class="muted">{{ decision ? decision.summary.join('；') : '选择模型后查看命中路由' }}</p>
          </div>
        </div>
        <div v-if="decision" class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>通道</th>
                <th>站点</th>
                <th>账号</th>
                <th>分数</th>
                <th>概率</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="candidate in decision.candidates.slice(0, 8)" :key="candidate.channelId">
                <td>#{{ candidate.channelId }}</td>
                <td>{{ candidate.siteName }}</td>
                <td>{{ candidate.accountName || candidate.accountId }}</td>
                <td>{{ candidate.score.toFixed(2) }}</td>
                <td>{{ (candidate.probability * 100).toFixed(1) }}%</td>
                <td>
                  <span class="badge" :class="candidate.available ? 'success' : 'disabled'">
                    {{ candidate.available ? '可用' : '过滤' }}
                  </span>
                </td>
              </tr>
              <tr v-if="decision.candidates.length === 0">
                <td class="empty" colspan="6">暂无候选通道</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="empty">暂无路由解释</div>
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
      <div class="table-wrap">
        <table class="data-table">
          <tbody>
            <tr>
              <th>最终上游</th>
              <td class="mono">{{ selectedTrace.finalUpstreamPath || '-' }}</td>
            </tr>
            <tr>
              <th>决策摘要</th>
              <td><pre class="mono">{{ formatJson(selectedTrace.decisionSummary) }}</pre></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>
