<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, type StatsMarketplaceItem } from '@web/api';

type SortKey = 'accountCount' | 'tokenCount' | 'successRate' | 'avgLatencyMs' | 'minCost';

const models = ref<StatsMarketplaceItem[]>([]);
const loading = ref(false);
const error = ref('');
const keyword = ref('');
const sortKey = ref<SortKey>('accountCount');
const sortOptions = [
  { label: '按账号数', value: 'accountCount' },
  { label: '按凭据数', value: 'tokenCount' },
  { label: '按成功率', value: 'successRate' },
  { label: '按延迟', value: 'avgLatencyMs' },
  { label: '按成本', value: 'minCost' }
];

const filteredModels = computed(() => {
  const text = keyword.value.trim().toLowerCase();
  const items = text ? models.value.filter((item) => item.model.toLowerCase().includes(text)) : models.value.slice();
  return items.sort((left, right) => compareModel(left, right, sortKey.value));
});

const summaryCards = computed(() => {
  const modelCount = models.value.length;
  const accountCount = models.value.reduce((sum, item) => sum + item.accountCount, 0);
  const tokenCount = models.value.reduce((sum, item) => sum + item.tokenCount, 0);
  const averageSuccessRate = models.value.length > 0
    ? models.value.reduce((sum, item) => sum + item.successRate, 0) / models.value.length
    : 0;
  return [
    { label: '模型数', value: formatInteger(modelCount) },
    { label: '覆盖账号', value: formatInteger(accountCount) },
    { label: '凭据数', value: formatInteger(tokenCount) },
    { label: '平均成功率', value: formatPercent(averageSuccessRate) }
  ];
});

function compareModel(left: StatsMarketplaceItem, right: StatsMarketplaceItem, key: SortKey) {
  if (key === 'avgLatencyMs' || key === 'minCost') {
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
          <p class="muted">按活跃上游、账号、内部凭据和最近代理日志聚合。</p>
        </div>
        <n-button secondary attr-type="button" :disabled="loading" @click="loadModels">
          {{ loading ? '刷新中' : '刷新' }}
        </n-button>
      </div>
      <n-alert v-if="error" type="error" :bordered="false">{{ error }}</n-alert>
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
          <p class="muted">最低成本来自账号单位成本，成功率按最近 7 天代理日志计算。</p>
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
              <th>上游地址</th>
              <th>账号</th>
              <th>凭据</th>
              <th>最低成本</th>
              <th>平均延迟</th>
              <th>成功率</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in filteredModels" :key="item.model">
              <td class="mono">{{ item.model }}</td>
              <td>{{ formatInteger(item.siteCount) }}</td>
              <td>{{ formatInteger(item.accountCount) }}</td>
              <td>{{ formatInteger(item.tokenCount) }}</td>
              <td class="mono">{{ formatCost(item.minCost) }}</td>
              <td class="mono">{{ formatLatency(item.avgLatencyMs) }}</td>
              <td>
                <n-tag size="small" :type="successRateTagType(item.successRate)">
                  {{ item.successRate > 0 ? formatPercent(item.successRate) : '-' }}
                </n-tag>
              </td>
            </tr>
            <tr v-if="!loading && filteredModels.length === 0">
              <td class="empty" colspan="7">暂无模型数据</td>
            </tr>
          </tbody>
        </n-table>
      </div>
    </n-card>
  </section>
</template>
