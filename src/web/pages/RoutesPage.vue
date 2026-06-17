<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useMessage } from 'naive-ui';
import { InformationCircleOutline } from '@vicons/ionicons5';
import { api, type RouteChannel, type RouteDecision, type RouteItem, type RoutingStrategy } from '@web/api';

const routes = ref<RouteItem[]>([]);
const channels = ref<RouteChannel[]>([]);
const decision = ref<RouteDecision | null>(null);
const selectedRoute = ref<RouteItem | null>(null);
const channelDrawerVisible = ref(false);
const loading = ref(false);
const savingStrategy = ref(false);
const savingChannelId = ref<number | null>(null);
const error = ref('');
const message = ref('');
const now = ref(Date.now());
const channelPriorityDrafts = ref<Record<number, number | null>>({});
const channelWeightDrafts = ref<Record<number, number | null>>({});
let cooldownTimer: ReturnType<typeof window.setInterval> | null = null;
const notice = useMessage();
const routeStrategy = ref<RoutingStrategy>('weighted');
const routingStrategyOptions: Array<{ label: string; value: RoutingStrategy }> = [
  { label: '加权随机', value: 'weighted' },
  { label: '稳定优先', value: 'stable_first' }
];
const hasCoolingChannel = computed(() => channels.value.some((channel) => isCooling(channel)));
const strategyAlert = computed(() => {
  if (routeStrategy.value === 'stable_first') {
    return {
      title: '稳定优先',
      content: '先按优先级筛到最小值，再按综合分数固定选择最高分通道；结果稳定，不走随机。'
    };
  }
  return {
    title: '加权随机',
    content: '先按优先级筛到最小值，再按权重、站点权重和失败惩罚计算概率随机挑选通道。'
  };
});

watch(message, (value) => {
  if (value) notice.success(value);
});

watch(error, (value) => {
  if (value) notice.error(value);
});

watch(hasCoolingChannel, syncCooldownTimer);

function normalizeRoutingStrategy(value: string | null | undefined): RoutingStrategy {
  return value === 'stable_first' ? 'stable_first' : 'weighted';
}

function setError(err: unknown, fallback: string) {
  error.value = err instanceof Error ? err.message : fallback;
}

function formatTime(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : '-';
}

function isCooling(channel: RouteChannel) {
  if (!channel.cooldownUntil) return false;
  const cooldownAt = Date.parse(channel.cooldownUntil);
  return !Number.isNaN(cooldownAt) && cooldownAt > now.value;
}

function formatCooldown(channel: RouteChannel) {
  if (!channel.cooldownUntil) return '-';
  const cooldownAt = Date.parse(channel.cooldownUntil);
  if (Number.isNaN(cooldownAt)) return '-';
  const remainingMs = cooldownAt - now.value;
  if (remainingMs <= 0) return '已结束';
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}秒`;
  return `${minutes}分${String(seconds).padStart(2, '0')}秒`;
}

function cooldownDetail(channel: RouteChannel) {
  return [
    `最后失败：${formatTime(channel.lastFailAt)}`,
    `冷却结束：${formatTime(channel.cooldownUntil)}`,
    `失败详情：${channel.lastFailureReason || '暂无详情'}`
  ].join('\n');
}

function syncChannelDrafts(items: RouteChannel[]) {
  // 输入框先走本地草稿，避免数字每次变动都立刻触发保存。
  const priorityDrafts: Record<number, number | null> = {};
  const weightDrafts: Record<number, number | null> = {};
  for (const item of items) {
    priorityDrafts[item.id] = item.priority;
    weightDrafts[item.id] = item.weight;
  }
  channelPriorityDrafts.value = priorityDrafts;
  channelWeightDrafts.value = weightDrafts;
}

function normalizePriorityValue(value: number | null | undefined) {
  return Math.max(0, Math.trunc(Number(value) || 0));
}

function normalizeWeightValue(value: number | null | undefined) {
  return Math.max(1, Math.trunc(Number(value) || 1));
}

function formatDecisionReason(reason: string) {
  // 后端返回的是机器原因码，这里转成人能直接读懂的中文说明。
  if (reason === 'excluded_channel') return '已排除该通道';
  if (reason === 'not_forced_channel') return '不是当前指定通道';
  if (reason === 'model_mismatch') return '模型不匹配';
  if (reason === 'site_inactive') return '站点未启用';
  if (reason === 'account_inactive') return '上游账号未启用';
  if (reason === 'site_model_disabled') return '站点已禁用该模型';
  if (reason === 'missing_account_api_key') return '缺少账号凭证';
  if (reason === 'model_denied_by_downstream_key') return '被密钥模型范围限制';
  if (reason === 'account_denied_by_downstream_key') return '被密钥授权范围限制';
  if (reason === 'cooldown') return '通道冷却中';
  if (reason.startsWith('weight=')) return `权重：${reason.slice('weight='.length)}`;
  if (reason.startsWith('siteWeight=')) return `站点权重：${reason.slice('siteWeight='.length)}`;
  if (reason.startsWith('failPenalty=')) return `失败惩罚：${reason.slice('failPenalty='.length)}`;
  return reason;
}

function formatDecisionReasons(reasons: string[]) {
  return reasons.map(formatDecisionReason).join('，');
}

function syncCooldownTimer() {
  if (hasCoolingChannel.value && !cooldownTimer) {
    cooldownTimer = window.setInterval(() => {
      now.value = Date.now();
    }, 1000);
  }
  if (!hasCoolingChannel.value && cooldownTimer) {
    window.clearInterval(cooldownTimer);
    cooldownTimer = null;
  }
}

async function loadRoutes() {
  loading.value = true;
  error.value = '';
  try {
    const data = await api.listRoutes();
    routes.value = data.items;
    if (selectedRoute.value) {
      selectedRoute.value = routes.value.find((item) => item.id === selectedRoute.value?.id) || null;
      if (!selectedRoute.value) {
        channels.value = [];
        decision.value = null;
        channelDrawerVisible.value = false;
        syncChannelDrafts([]);
      } else {
        routeStrategy.value = normalizeRoutingStrategy(selectedRoute.value.routingStrategy);
      }
    }
  } catch (err) {
    setError(err, '加载模型失败');
  } finally {
    loading.value = false;
  }
}

async function rebuild() {
  error.value = '';
  message.value = '';
  try {
    await api.rebuildRoutes();
    message.value = '模型已重建';
    await loadRoutes();
  } catch (err) {
    setError(err, '重建模型失败');
  }
}

async function toggleRoute(route: RouteItem) {
  error.value = '';
  message.value = '';
  try {
    await api.updateRoute(route.id, { enabled: !route.enabled });
    message.value = route.enabled ? '模型已停用' : '模型已启用';
    await loadRoutes();
  } catch (err) {
    setError(err, '更新模型失败');
  }
}

async function selectRoute(route: RouteItem) {
  selectedRoute.value = route;
  routeStrategy.value = normalizeRoutingStrategy(route.routingStrategy);
  now.value = Date.now();
  channels.value = [];
  decision.value = null;
  error.value = '';
  try {
    const data = await api.listRouteChannels(route.id);
    channels.value = data.items;
    syncChannelDrafts(data.items);
  } catch (err) {
    setError(err, '加载通道失败');
  }
}

async function saveRouteStrategy(route = selectedRoute.value) {
  if (!route) return;
  savingStrategy.value = true;
  error.value = '';
  message.value = '';
  try {
    await api.updateRoute(route.id, { routingStrategy: routeStrategy.value });
    await loadRoutes();
    await explainRoute(selectedRoute.value || route);
    message.value = '调用策略已保存';
  } catch (err) {
    setError(err, '保存调用策略失败');
  } finally {
    savingStrategy.value = false;
  }
}

async function saveChannel(channel: RouteChannel, patch: { priority?: number | null; weight?: number | null; enabled?: boolean }) {
  if (!selectedRoute.value) return;
  savingChannelId.value = channel.id;
  error.value = '';
  message.value = '';
  try {
    const payload: { priority?: number; weight?: number; enabled?: boolean } = {};
    if (patch.priority !== undefined) {
      payload.priority = normalizePriorityValue(patch.priority);
    }
    if (patch.weight !== undefined) {
      payload.weight = normalizeWeightValue(patch.weight);
    }
    if (patch.enabled !== undefined) {
      payload.enabled = patch.enabled;
    }
    await api.updateRouteChannel(selectedRoute.value.id, channel.id, payload);
    message.value = '通道已保存';
    await selectRoute(selectedRoute.value);
    await explainRoute(selectedRoute.value);
  } catch (err) {
    setError(err, '保存通道失败');
  } finally {
    savingChannelId.value = null;
  }
}

async function saveChannelDraft(channel: RouteChannel, field: 'priority' | 'weight') {
  const draft = field === 'priority'
    ? channelPriorityDrafts.value[channel.id]
    : channelWeightDrafts.value[channel.id];
  const nextValue = field === 'priority' ? normalizePriorityValue(draft) : normalizeWeightValue(draft);
  const currentValue = field === 'priority' ? channel.priority : channel.weight;
  if (field === 'priority') channelPriorityDrafts.value[channel.id] = nextValue;
  else channelWeightDrafts.value[channel.id] = nextValue;
  if (currentValue === nextValue) return;
  await saveChannel(channel, field === 'priority' ? { priority: nextValue } : { weight: nextValue });
}

async function openChannelDrawer(route: RouteItem) {
  await selectRoute(route);
  channelDrawerVisible.value = true;
  await explainRoute(route);
}

async function explainRoute(route = selectedRoute.value) {
  if (!route) return;
  error.value = '';
  try {
    const model = route.displayName || route.modelPattern;
    decision.value = await api.explainRouteDecision(route.id, model);
  } catch (err) {
    setError(err, '加载决策解释失败');
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

onBeforeUnmount(() => {
  if (cooldownTimer) window.clearInterval(cooldownTimer);
});
</script>

<template>
  <section class="page-stack">
    <n-card class="admin-card" :bordered="false">
      <div class="panel-header">
        <div>
          <h2>模型</h2>
          <p class="muted">显示所有已启用上游账号中当前可用、且至少有一个上游账号通道的模型；停用模型和停用通道仍保留在列表中。</p>
        </div>
        <div class="actions">
          <n-button secondary attr-type="button" @click="loadRoutes">刷新</n-button>
          <n-button type="primary" attr-type="button" @click="rebuild">重建模型</n-button>
        </div>
      </div>
      <div class="explain-grid">
        <div class="explain-item">
          <strong>模型</strong>
          <span>这里的模型来自已启用上游账号的可用模型记录。请求 `/v1/*` 时，系统按客户端传入的模型名匹配，并在可用通道中选择一个上游账号转发。</span>
        </div>
        <div class="explain-item">
          <strong>通道</strong>
          <span>通道是“模型 + 上游账号”的可用转发路径。一个模型可以有多个通道，系统按优先级、权重、冷却状态和密钥策略选择。</span>
        </div>
      </div>
      <div class="button-help">
        <span><strong>刷新</strong>：重新读取列表，不改数据。</span>
        <span><strong>重建模型</strong>：按上游账号可用模型重新生成模型和通道。</span>
        <span><strong>通道</strong>：查看可转发上游账号，并维护策略和决策解释。</span>
        <span><strong>停用/启用</strong>：控制该模型是否参与转发。</span>
        <span><strong>清冷却</strong>：清除该模型下通道的失败冷却。</span>
      </div>
      <div class="table-wrap">
        <n-table size="small" :bordered="false" single-line class="admin-table">
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
              <td>
                <n-tag size="small" :type="route.enabled ? 'success' : 'error'">{{ route.enabled ? '启用' : '停用' }}</n-tag>
              </td>
              <td class="actions">
                <n-button text attr-type="button" @click="openChannelDrawer(route)">通道</n-button>
                <n-button text attr-type="button" @click="toggleRoute(route)">
                  {{ route.enabled ? '停用' : '启用' }}
                </n-button>
                <n-button text attr-type="button" @click="clearCooldown(route)">清冷却</n-button>
              </td>
            </tr>
            <tr v-if="!loading && routes.length === 0">
              <td class="empty" colspan="8">暂无模型</td>
            </tr>
          </tbody>
        </n-table>
      </div>
    </n-card>

    <n-drawer v-model:show="channelDrawerVisible" placement="right" width="min(900px, calc(100vw - 24px))">
      <n-drawer-content :title="selectedRoute ? `模型通道：${selectedRoute.modelPattern}` : '模型通道'">
        <div class="page-stack">
          <div class="strategy-toolbar">
            <label class="field strategy-field">
              <span>调用策略</span>
              <n-select
                v-model:value="routeStrategy"
                :options="routingStrategyOptions"
                :disabled="!selectedRoute"
                :consistent-menu-width="false"
              />
            </label>
            <n-button
              class="strategy-save-button"
              type="primary"
              attr-type="button"
              :disabled="!selectedRoute || savingStrategy"
              @click="saveRouteStrategy()"
            >
              {{ savingStrategy ? '保存中' : '保存策略' }}
            </n-button>
          </div>
          <n-alert v-if="selectedRoute" type="info" :title="strategyAlert.title">
            {{ strategyAlert.content }}
          </n-alert>
          <div class="table-wrap">
            <n-table size="small" :bordered="false" single-line class="admin-table">
              <thead>
                <tr>
                  <th>上游账号</th>
                  <th>来源模型</th>
                  <th>优先级（越小越优先）</th>
                  <th>权重（越大概率越高）</th>
                  <th>冷却</th>
                  <th>成功/失败</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="channel in channels" :key="channel.id">
                  <td>{{ channel.accountName || channel.accountId }}</td>
                  <td class="mono">{{ channel.sourceModel }}</td>
                  <td>
                    <n-input-number
                      v-model:value="channelPriorityDrafts[channel.id]"
                      size="small"
                      :min="0"
                      :disabled="savingChannelId === channel.id"
                      @blur="saveChannelDraft(channel, 'priority')"
                    />
                  </td>
                  <td>
                    <n-input-number
                      v-model:value="channelWeightDrafts[channel.id]"
                      size="small"
                      :min="1"
                      :disabled="savingChannelId === channel.id"
                      @blur="saveChannelDraft(channel, 'weight')"
                    />
                  </td>
                  <td>
                    <span class="cooldown-cell">
                      <span>{{ formatCooldown(channel) }}</span>
                      <n-tooltip v-if="channel.lastFailureReason || channel.lastFailAt || channel.cooldownUntil" trigger="hover">
                        <template #trigger>
                          <n-icon class="info-icon" size="16">
                            <InformationCircleOutline />
                          </n-icon>
                        </template>
                        <span class="tooltip-text">{{ cooldownDetail(channel) }}</span>
                      </n-tooltip>
                    </span>
                  </td>
                  <td>{{ channel.successCount }} / {{ channel.failCount }}</td>
                  <td>
                    <n-switch
                      :value="channel.enabled"
                      :disabled="savingChannelId === channel.id"
                      @update:value="(enabled) => saveChannel(channel, { enabled })"
                    >
                      <template #checked>启用</template>
                      <template #unchecked>停用</template>
                    </n-switch>
                  </td>
                </tr>
                <tr v-if="channels.length === 0">
                  <td class="empty" colspan="7">暂无通道</td>
                </tr>
              </tbody>
            </n-table>
          </div>

          <n-card class="admin-card" :bordered="false">
            <div class="panel-header">
              <div>
                <h2>决策解释</h2>
                <p class="muted">{{ decision ? `${decision.requestedModel} -> ${decision.actualModel}` : '选择模型后查看候选、分数和过滤原因' }}</p>
              </div>
              <n-button secondary attr-type="button" :disabled="!selectedRoute" @click="explainRoute()">刷新</n-button>
            </div>
            <div v-if="decision" class="page-stack">
              <p class="muted">{{ decision.summary.join('；') }}</p>
              <div class="table-wrap">
                <n-table size="small" :bordered="false" single-line class="admin-table">
                  <thead>
                    <tr>
                      <th>上游账号</th>
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
                      <td>{{ candidate.accountName || candidate.accountId }}</td>
                      <td>{{ candidate.priority }}</td>
                      <td>{{ candidate.weight }}</td>
                      <td>{{ candidate.score.toFixed(4) }}</td>
                      <td>{{ (candidate.probability * 100).toFixed(1) }}%</td>
                      <td>
                        <n-tag size="small" :type="candidate.available ? 'success' : 'error'">
                          {{ candidate.available ? '可用' : '过滤' }}
                        </n-tag>
                      </td>
                      <td>{{ formatDecisionReasons(candidate.reasons) }}</td>
                    </tr>
                    <tr v-if="decision.candidates.length === 0">
                      <td class="empty" colspan="7">暂无候选</td>
                    </tr>
                  </tbody>
                </n-table>
              </div>
            </div>
          </n-card>
        </div>
      </n-drawer-content>
    </n-drawer>
  </section>
</template>

<style scoped lang="scss">
.strategy-toolbar {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  flex-wrap: wrap;
}

.strategy-field {
  flex: 1;
  min-width: 320px;
}

.strategy-save-button {
  flex-shrink: 0;
}

.cooldown-cell {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.info-icon {
  color: #64748b;
  cursor: help;
}

.tooltip-text {
  display: inline-block;
  white-space: pre-line;
  max-width: 360px;
  line-height: 1.6;
}
</style>
