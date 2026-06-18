<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useMessage } from 'naive-ui';
import { api, type StatsMarketplaceItem } from '@web/api';

type SortKey = 'accountCount' | 'successRate' | 'avgLatencyMs' | 'minCost' | 'avgCost';

const models = ref<StatsMarketplaceItem[]>([]);
const loading = ref(false);
const error = ref('');
const keyword = ref('');
const sortKey = ref<SortKey>('accountCount');
const notice = useMessage();
const sortOptions = [
  { label: '按上游账号数', value: 'accountCount' },
  { label: '按成功率', value: 'successRate' },
  { label: '按延迟', value: 'avgLatencyMs' },
  { label: '按最低成本', value: 'minCost' },
  { label: '按平均成本', value: 'avgCost' }
];

watch(error, (value) => {
  if (value) notice.error(value);
});

const filteredModels = computed(() => {
  const text = keyword.value.trim().toLowerCase();
  const items = text ? models.value.filter((item) => item.model.toLowerCase().includes(text)) : models.value.slice();
  return items.sort((left, right) => compareModel(left, right, sortKey.value));
});

const summaryCards = computed(() => {
  const modelCount = models.value.length;
  const accountCount = models.value.reduce((sum, item) => sum + item.accountCount, 0);
  const averageSuccessRate = models.value.length > 0
    ? models.value.reduce((sum, item) => sum + item.successRate, 0) / models.value.length
    : 0;
  return [
    { label: '模型数', value: formatInteger(modelCount) },
    { label: '覆盖上游账号', value: formatInteger(accountCount) },
    { label: '平均成功率', value: formatPercent(averageSuccessRate) }
  ];
});

function compareModel(left: StatsMarketplaceItem, right: StatsMarketplaceItem, key: SortKey) {
  if (key === 'avgLatencyMs' || key === 'minCost' || key === 'avgCost') {
    return left[key] - right[key] || left.model.localeCompare(right.model);
  }
  return right[key] - left[key] || left.model.localeCompare(right.model);
}

function formatInteger(value: number) {
  return new Intl.NumberFormat('zh-CN').format(value);
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatCost(value: number) {
  return value > 0 ? `$${value.toFixed(4)}` : '-';
}

function formatLatency(value: number) {
  return value > 0 ? `${Math.round(value)}ms` : '-';
}

function successRateTagType(value: number) {
  if (value >= 0.95) return 'success';
  if (value > 0) return 'warning';
  return 'error';
}

async function loadModels() {
  loading.value = true;
  error.value = '';
  try {
    const data = await api.getStatsMarketplace();
    models.value = data.items;
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加载模型广场失败';
  } finally {
    loading.value = false;
  }
}

onMounted(loadModels);
</script>

<template>
  <section class="page-stack">
    <n-card class="admin-card" :bordered="false">
      <div class="panel-header">
        <div>
          <h2>模型广场</h2>
          <p class="muted">按上游账号和最近代理日志聚合。</p>
        </div>
        <n-button secondary attr-type="button" :disabled="loading" @click="loadModels">
          {{ loading ? '刷新中' : '刷新' }}
        </n-button>
      </div>
      <div class="stats-grid">
        <div v-for="card in summaryCards" :key="card.label" class="stat-card">
          <span class="stat-label">{{ card.label }}</span>
          <strong class="stat-value">{{ card.value }}</strong>
        </div>
      </div>
    </n-card>

    <n-card class="admin-card" :bordered="false">
      <div class="panel-header">
        <div>
          <h2>模型覆盖</h2>
          <p class="muted">成本来自当前可用通道，成功率按最近 7 天代理日志计算。</p>
        </div>
      </div>
      <div class="toolbar">
        <n-input v-model:value="keyword" placeholder="搜索模型" />
        <n-select v-model:value="sortKey" :options="sortOptions" class="toolbar-select" />
        <span class="muted">匹配 {{ filteredModels.length }} / {{ models.length }}</span>
      </div>
      <div class="table-wrap">
        <n-table size="small" :bordered="false" single-line class="admin-table">
          <thead>
            <tr>
              <th>模型</th>
              <th>上游账号</th>
              <th>最低成本</th>
              <th>平均成本</th>
              <th>平均延迟</th>
              <th>成功率</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in filteredModels" :key="item.model">
              <td class="mono">{{ item.model }}</td>
              <td>{{ formatInteger(item.accountCount) }}</td>
              <td class="mono">{{ formatCost(item.minCost) }}</td>
              <td class="mono">{{ formatCost(item.avgCost) }}</td>
              <td class="mono">{{ formatLatency(item.avgLatencyMs) }}</td>
              <td>
                <n-tag size="small" :type="successRateTagType(item.successRate)">
                  {{ item.successRate > 0 ? formatPercent(item.successRate) : '-' }}
                </n-tag>
              </td>
            </tr>
            <tr v-if="!loading && filteredModels.length === 0">
              <td class="empty" colspan="6">暂无模型数据</td>
            </tr>
          </tbody>
        </n-table>
      </div>
    </n-card>
  </section>
</template>
