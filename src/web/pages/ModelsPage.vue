<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, type StatsMarketplaceItem } from '@web/api';

type SortKey = 'accountCount' | 'tokenCount' | 'successRate' | 'avgLatencyMs' | 'minCost';

const models = ref<StatsMarketplaceItem[]>([]);
const loading = ref(false);
const error = ref('');
const keyword = ref('');
const sortKey = ref<SortKey>('accountCount');

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
    { label: 'Token 数', value: formatInteger(tokenCount) },
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
    <div class="panel">
      <div class="panel-header">
        <div>
          <h2>模型广场</h2>
          <p class="muted">按活跃站点、账号、Token 和最近代理日志聚合。</p>
        </div>
        <button class="btn btn-secondary" type="button" :disabled="loading" @click="loadModels">
          {{ loading ? '刷新中' : '刷新' }}
        </button>
      </div>
      <p v-if="error" class="error">{{ error }}</p>
      <div class="stats-grid">
        <div v-for="card in summaryCards" :key="card.label" class="stat-card">
          <span class="stat-label">{{ card.label }}</span>
          <strong class="stat-value">{{ card.value }}</strong>
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header">
        <div>
          <h2>模型覆盖</h2>
          <p class="muted">最低成本来自账号单位成本，成功率按最近 7 天代理日志计算。</p>
        </div>
      </div>
      <div class="toolbar">
        <input v-model="keyword" class="input" placeholder="搜索模型" />
        <select v-model="sortKey" class="select">
          <option value="accountCount">按账号数</option>
          <option value="tokenCount">按 Token 数</option>
          <option value="successRate">按成功率</option>
          <option value="avgLatencyMs">按延迟</option>
          <option value="minCost">按成本</option>
        </select>
        <span class="muted">匹配 {{ filteredModels.length }} / {{ models.length }}</span>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>模型</th>
              <th>站点</th>
              <th>账号</th>
              <th>Token</th>
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
                <span class="badge" :class="item.successRate >= 0.95 ? 'success' : item.successRate > 0 ? 'retried' : 'disabled'">
                  {{ item.successRate > 0 ? formatPercent(item.successRate) : '-' }}
                </span>
              </td>
            </tr>
            <tr v-if="!loading && filteredModels.length === 0">
              <td class="empty" colspan="7">暂无模型数据</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>
