<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useMessage } from 'naive-ui';
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
const notice = useMessage();
const form = reactive({
  model: '',
  downstreamApiKeyId: '',
  forcedChannelId: '',
  system: '',
  prompt: 'hello',
  temperature: ''
});

watch(message, (value) => {
  if (value) notice.success(value);
});

watch(error, (value) => {
  if (value) notice.error(value);
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
const modelSelectOptions = computed(() => modelOptions.value.map((model) => ({ label: model, value: model })));
const downstreamKeyOptions = computed(() => [
  { label: '全局策略', value: '' },
  ...downstreamKeys.value.map((key) => ({
    label: `${key.name} / ${key.keyMasked}${key.enabled ? '' : ' / 停用'}`,
    value: String(key.id)
  }))
]);
const channelOptions = computed(() => [
  { label: '自动选择', value: '' },
  ...channels.value.map((channel) => ({
    label: `#${channel.id} / ${channel.accountName || channel.accountId}`,
    value: String(channel.id)
  }))
]);

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
    setError(err, '加载模型解释失败');
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
    <n-card class="admin-card" :bordered="false">
      <div class="panel-header">
        <div>
          <h2>模型操练场</h2>
          <p class="muted">复用管理端测试入口，当前支持非流式 Chat。</p>
        </div>
        <n-button secondary attr-type="button" :disabled="loading" @click="loadData">
          {{ loading ? '刷新中' : '刷新模型' }}
        </n-button>
      </div>
      <form class="form-grid" @submit.prevent="sendTest">
        <label class="field">
          <span>模型</span>
          <n-select v-model:value="form.model" filterable :options="modelSelectOptions" @update:value="handleModelChange" />
        </label>
        <label class="field">
          <span>密钥</span>
          <n-select v-model:value="form.downstreamApiKeyId" :options="downstreamKeyOptions" @update:value="explainSelectedRoute" />
        </label>
        <label class="field">
          <span>Temperature</span>
          <n-input v-model:value="form.temperature" placeholder="默认" />
        </label>
        <label class="field">
          <span>模型</span>
          <n-input :value="selectedRoute ? selectedRoute.modelPattern : '自动匹配'" disabled />
        </label>
        <label class="field">
          <span>强制通道</span>
          <n-select
            v-model:value="form.forcedChannelId"
            :options="channelOptions"
            :disabled="channels.length === 0"
            @update:value="explainSelectedRoute"
          />
        </label>
        <label class="field wide">
          <span>System</span>
          <n-input type="textarea" v-model:value="form.system" placeholder="可选"></n-input>
        </label>
        <label class="field wide">
          <span>Prompt</span>
          <n-input type="textarea" v-model:value="form.prompt" required></n-input>
        </label>
        <div class="form-actions wide">
          <n-button type="primary" attr-type="submit" :disabled="sending || !form.model">
            {{ sending ? '请求中' : '发送测试' }}
          </n-button>
          <n-button secondary attr-type="button" :disabled="!selectedRoute" @click="explainSelectedRoute">解释模型</n-button>
        </div>
      </form>
    </n-card>

    <div class="two-column">
      <n-card class="admin-card" :bordered="false">
        <div class="panel-header">
          <div>
            <h2>响应</h2>
            <p class="muted">返回上游 JSON，便于核对模型和 usage。</p>
          </div>
          <n-button secondary
            v-if="responseTraceId"
            attr-type="button"
            :disabled="loadingTrace"
            @click="loadTrace(responseTraceId)"
          >
            {{ loadingTrace ? '加载中' : `Trace #${responseTraceId}` }}
          </n-button>
        </div>
        <n-input type="textarea" readonly :value="responseText" placeholder="发送测试后显示响应"></n-input>
      </n-card>

      <n-card class="admin-card" :bordered="false">
        <div class="panel-header">
          <div>
            <h2>模型解释</h2>
            <p class="muted">{{ decision ? decision.summary.join('；') : '选择模型后查看命中结果' }}</p>
          </div>
        </div>
        <div v-if="decision" class="table-wrap">
          <n-table size="small" :bordered="false" single-line class="admin-table">
            <thead>
              <tr>
                <th>通道</th>
                <th>上游账号</th>
                <th>分数</th>
                <th>概率</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="candidate in decision.candidates.slice(0, 8)" :key="candidate.channelId">
                <td>#{{ candidate.channelId }}</td>
                <td>{{ candidate.accountName || candidate.accountId }}</td>
                <td>{{ candidate.score.toFixed(2) }}</td>
                <td>{{ (candidate.probability * 100).toFixed(1) }}%</td>
                <td>
                  <n-tag size="small" :type="candidate.available ? 'success' : 'error'">
                    {{ candidate.available ? '可用' : '过滤' }}
                  </n-tag>
                </td>
              </tr>
              <tr v-if="decision.candidates.length === 0">
                <td class="empty" colspan="5">暂无候选通道</td>
              </tr>
            </tbody>
          </n-table>
        </div>
        <div v-else class="empty">暂无模型解释</div>
      </n-card>
    </div>

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
      <div class="table-wrap">
        <n-table size="small" :bordered="false" single-line class="admin-table">
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
        </n-table>
      </div>
    </n-card>
  </section>
</template>
