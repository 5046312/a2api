<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, type RouteChannel, type RouteDecision, type RouteDecisionSnapshot, type RouteGroupSource, type RouteItem, type RouteSummaryItem } from '@web/api';

const routes = ref<RouteItem[]>([]);
const routeSummaries = ref<RouteSummaryItem[]>([]);
const channels = ref<RouteChannel[]>([]);
const decision = ref<RouteDecision | null>(null);
const snapshot = ref<RouteDecisionSnapshot | null>(null);
const groupSources = ref<RouteGroupSource[]>([]);
const selectedRoute = ref<RouteItem | null>(null);
const decisionModel = ref('');
const groupSourceIdsText = ref('');
const loading = ref(false);
const error = ref('');
const message = ref('');

function setError(err: unknown, fallback: string) {
  error.value = err instanceof Error ? err.message : fallback;
}

async function loadRoutes() {
  loading.value = true;
  error.value = '';
  try {
    const data = await api.listRoutes();
    routes.value = data.items;
    routeSummaries.value = await api.listRoutesSummary();
    if (selectedRoute.value) {
      selectedRoute.value = routes.value.find((item) => item.id === selectedRoute.value?.id) || null;
    }
  } catch (err) {
    setError(err, '加载路由失败');
  } finally {
    loading.value = false;
  }
}

async function rebuild() {
  error.value = '';
  message.value = '';
  try {
    await api.rebuildRoutes();
    message.value = '路由已重建';
    await loadRoutes();
  } catch (err) {
    setError(err, '重建路由失败');
  }
}

async function toggleRoute(route: RouteItem) {
  error.value = '';
  message.value = '';
  try {
    await api.updateRoute(route.id, { enabled: !route.enabled });
    message.value = route.enabled ? '路由已停用' : '路由已启用';
    await loadRoutes();
  } catch (err) {
    setError(err, '更新路由失败');
  }
}

async function selectRoute(route: RouteItem) {
  selectedRoute.value = route;
  channels.value = [];
  decision.value = null;
  snapshot.value = null;
  groupSources.value = [];
  decisionModel.value = route.displayName || route.modelPattern;
  groupSourceIdsText.value = '';
  error.value = '';
  try {
    const [data, sourceData] = await Promise.all([
      api.listRouteChannels(route.id),
      api.listRouteGroupSources(route.id)
    ]);
    channels.value = data.items;
    groupSources.value = sourceData.items;
    groupSourceIdsText.value = sourceData.items.map((item) => item.sourceRouteId).join(', ');
  } catch (err) {
    setError(err, '加载通道失败');
  }
}

async function explainRoute(route = selectedRoute.value) {
  if (!route) return;
  error.value = '';
  message.value = '';
  try {
    const model = decisionModel.value.trim() || route.displayName || route.modelPattern;
    decision.value = await api.explainRouteDecision(route.id, model);
  } catch (err) {
    setError(err, '加载决策解释失败');
  }
}

async function refreshSnapshot(route = selectedRoute.value) {
  if (!route) return;
  error.value = '';
  message.value = '';
  try {
    snapshot.value = await api.refreshRouteSnapshot(route.id, decisionModel.value.trim() || route.displayName || route.modelPattern);
    message.value = '决策快照已刷新';
  } catch (err) {
    setError(err, '刷新决策快照失败');
  }
}

async function loadSnapshot(route = selectedRoute.value) {
  if (!route) return;
  error.value = '';
  try {
    snapshot.value = await api.getRouteSnapshot(route.id);
  } catch (err) {
    setError(err, '暂无决策快照');
  }
}

async function saveGroupSources(route = selectedRoute.value) {
  if (!route) return;
  error.value = '';
  message.value = '';
  try {
    const sourceRouteIds = groupSourceIdsText.value
      .split(',')
      .map((item) => Number(item.trim()))
      .filter((item) => Number.isInteger(item) && item > 0);
    await api.updateRouteGroupSources(route.id, sourceRouteIds);
    message.value = '分组来源已保存';
    await selectRoute(route);
  } catch (err) {
    setError(err, '保存分组来源失败');
  }
}

async function clearCooldown(route: RouteItem) {
  error.value = '';
  message.value = '';
  try {
    await api.clearRouteCooldown(route.id);
    message.value = '冷却已清除';
    await selectRoute(route);
  } catch (err) {
    setError(err, '清除冷却失败');
  }
}

onMounted(loadRoutes);
</script>

<template>
  <section class="page-stack">
    <div class="panel">
      <div class="panel-header">
        <div>
          <h2>模型路由</h2>
          <p class="muted">根据账号模型生成可用路由和通道。</p>
        </div>
        <div class="actions">
          <button class="btn btn-secondary" type="button" @click="loadRoutes">刷新</button>
          <button class="btn btn-primary" type="button" @click="rebuild">重建路由</button>
        </div>
      </div>
      <p v-if="message" class="notice">{{ message }}</p>
      <p v-if="error" class="error">{{ error }}</p>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>模型</th>
              <th>显示名</th>
              <th>模式</th>
              <th>策略</th>
              <th>通道</th>
              <th>成功/失败</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="route in routes" :key="route.id" :class="{ selected: selectedRoute?.id === route.id }">
              <td class="mono">{{ route.modelPattern }}</td>
              <td>{{ route.displayName || '-' }}</td>
              <td>{{ route.routeMode }}</td>
              <td>{{ route.routingStrategy }}</td>
              <td>{{ route.channelCount }}</td>
              <td>{{ route.successCount }} / {{ route.failCount }}</td>
              <td><span class="badge" :class="route.enabled ? 'active' : 'disabled'">{{ route.enabled ? '启用' : '停用' }}</span></td>
              <td class="actions">
                <button class="text-btn" type="button" @click="selectRoute(route)">通道</button>
                <button class="text-btn" type="button" @click="selectRoute(route).then(() => explainRoute(route))">解释</button>
                <button class="text-btn" type="button" @click="toggleRoute(route)">
                  {{ route.enabled ? '停用' : '启用' }}
                </button>
                <button class="text-btn" type="button" @click="clearCooldown(route)">清冷却</button>
              </td>
            </tr>
            <tr v-if="!loading && routes.length === 0">
              <td class="empty" colspan="8">暂无路由</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="routeSummaries.length > 0" class="model-list">
        <span v-for="summary in routeSummaries.slice(0, 8)" :key="summary.id" class="chip">
          {{ summary.displayName || summary.modelPattern }}：{{ summary.enabledChannelCount }}/{{ summary.channelCount }}
        </span>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header">
        <div>
          <h2>路由通道</h2>
          <p class="muted">{{ selectedRoute ? selectedRoute.modelPattern : '选择路由后查看通道' }}</p>
        </div>
        <div class="actions">
          <input v-model="decisionModel" class="input" placeholder="请求模型" />
          <button class="btn btn-secondary" type="button" :disabled="!selectedRoute" @click="explainRoute()">解释决策</button>
          <button class="btn btn-secondary" type="button" :disabled="!selectedRoute" @click="refreshSnapshot()">刷新快照</button>
          <button class="btn btn-secondary" type="button" :disabled="!selectedRoute" @click="loadSnapshot()">读取快照</button>
        </div>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>站点</th>
              <th>账号</th>
              <th>Token</th>
              <th>来源模型</th>
              <th>优先级</th>
              <th>权重</th>
              <th>冷却</th>
              <th>成功/失败</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="channel in channels" :key="channel.id">
              <td>{{ channel.siteName || '-' }}</td>
              <td>{{ channel.accountName || channel.accountId }}</td>
              <td>{{ channel.tokenName || channel.tokenId || '-' }}</td>
              <td class="mono">{{ channel.sourceModel }}</td>
              <td>{{ channel.priority }}</td>
              <td>{{ channel.weight }}</td>
              <td>{{ channel.cooldownUntil || '-' }}</td>
              <td>{{ channel.successCount }} / {{ channel.failCount }}</td>
            </tr>
            <tr v-if="channels.length === 0">
              <td class="empty" colspan="8">暂无通道</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header">
        <div>
          <h2>路由分组与快照</h2>
          <p class="muted">{{ selectedRoute ? selectedRoute.modelPattern : '选择路由后维护分组来源和决策快照' }}</p>
        </div>
      </div>
      <label class="field">
        <span>来源路由 ID</span>
        <input v-model="groupSourceIdsText" class="input" placeholder="例如：1,2,3" />
      </label>
      <div class="actions">
        <button class="btn btn-secondary" type="button" :disabled="!selectedRoute" @click="saveGroupSources()">保存分组来源</button>
      </div>
      <div v-if="groupSources.length > 0" class="model-list">
        <span v-for="source in groupSources" :key="source.id" class="chip">
          #{{ source.sourceRouteId }} {{ source.displayName || source.modelPattern }}
        </span>
      </div>
      <pre v-if="snapshot" class="code-block">{{ JSON.stringify(snapshot.snapshot, null, 2) }}</pre>
    </div>

    <div class="panel">
      <div class="panel-header">
        <div>
          <h2>决策解释</h2>
          <p class="muted">{{ decision ? `${decision.requestedModel} -> ${decision.actualModel}` : '选择路由后查看候选、分数和过滤原因' }}</p>
        </div>
      </div>
      <div v-if="decision" class="page-stack">
        <p class="muted">{{ decision.summary.join('；') }}</p>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>通道</th>
                <th>站点</th>
                <th>账号</th>
                <th>Token</th>
                <th>优先级</th>
                <th>权重</th>
                <th>分数</th>
                <th>概率</th>
                <th>状态</th>
                <th>原因</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="candidate in decision.candidates" :key="candidate.channelId" :class="{ selected: decision.selectedChannelId === candidate.channelId }">
                <td>{{ candidate.channelId }}</td>
                <td>{{ candidate.siteName }}</td>
                <td>{{ candidate.accountName || candidate.accountId }}</td>
                <td>{{ candidate.tokenName || candidate.tokenId || '-' }}</td>
                <td>{{ candidate.priority }}</td>
                <td>{{ candidate.weight }}</td>
                <td>{{ candidate.score.toFixed(4) }}</td>
                <td>{{ (candidate.probability * 100).toFixed(1) }}%</td>
                <td><span class="badge" :class="candidate.available ? 'active' : 'failed'">{{ candidate.available ? '可用' : '过滤' }}</span></td>
                <td>{{ candidate.reasons.join('，') }}</td>
              </tr>
              <tr v-if="decision.candidates.length === 0">
                <td class="empty" colspan="10">暂无候选</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </section>
</template>
