<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, type ModelUsageItem, type SiteUsageItem, type StatsOverview } from '@web/api';

const overview = ref<StatsOverview | null>(null);
const siteUsage = ref<SiteUsageItem[]>([]);
const modelUsage = ref<ModelUsageItem[]>([]);
const loading = ref(false);
const error = ref('');

const cards = computed(() => {
  const data = overview.value;
  return [
    { label: '今日请求数', value: data ? formatInteger(data.todayRequests) : '-' },
    { label: '今日成功率', value: data ? formatPercent(data.todaySuccessRate) : '-' },
    { label: '今日 token', value: data ? formatInteger(data.todayTokens) : '-' },
    { label: '今日费用', value: data ? formatCost(data.todayCost) : '-' },
    { label: '活跃站点数', value: data ? formatInteger(data.activeSiteCount) : '-' },
    { label: '异常账号数', value: data ? formatInteger(data.abnormalAccountCount) : '-' }
  ];
});

const recentSiteUsage = computed(() => siteUsage.value.slice(-12).reverse());
const topModelUsage = computed(() => modelUsage.value.slice().sort((left, right) => right.totalTokens - left.totalTokens).slice(0, 10));

function setError(err: unknown) {
  error.value = err instanceof Error ? err.message : '加载统计失败';
}

function formatInteger(value: number) {
  return new Intl.NumberFormat('zh-CN').format(value);
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatCost(value: number) {
  return `$${value.toFixed(4)}`;
}

async function loadOverview() {
  loading.value = true;
  error.value = '';
  try {
    const [overviewData, siteUsageData, modelUsageData] = await Promise.all([
      api.getStatsOverview(),
      api.getSiteUsageStats({ range: '7d', bucket: 'day' }),
      api.getModelUsageStats({ range: '7d' })
    ]);
    overview.value = overviewData;
    siteUsage.value = siteUsageData.items;
    modelUsage.value = modelUsageData.items;
  } catch (err) {
    setError(err);
  } finally {
    loading.value = false;
  }
}

onMounted(loadOverview);
</script>

<template>
  <section class="page-stack">
    <div class="panel">
      <div class="panel-header">
        <div>
          <h2>运行总览</h2>
          <p class="muted">今日统计按服务端本地日期计算。</p>
        </div>
        <div class="actions">
          <button class="btn btn-secondary" type="button" :disabled="loading" @click="loadOverview">
            {{ loading ? '刷新中' : '刷新' }}
          </button>
        </div>
      </div>
      <p v-if="error" class="error">{{ error }}</p>
      <div class="stats-grid">
        <div v-for="card in cards" :key="card.label" class="stat-card">
          <span class="stat-label">{{ card.label }}</span>
          <strong class="stat-value">{{ card.value }}</strong>
        </div>
      </div>
    </div>

    <div class="two-column">
      <div class="panel">
        <div class="panel-header">
          <div>
            <h2>站点调用趋势</h2>
            <p class="muted">最近 7 天按天聚合。</p>
          </div>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>日期</th>
                <th>站点</th>
                <th>请求</th>
                <th>成功率</th>
                <th>Token</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in recentSiteUsage" :key="`${item.bucket}-${item.siteId || 0}`">
                <td class="mono">{{ item.bucket }}</td>
                <td>{{ item.siteName || '未知站点' }}</td>
                <td>{{ formatInteger(item.requests) }}</td>
                <td>{{ formatPercent(item.successRate) }}</td>
                <td>{{ formatInteger(item.totalTokens) }}</td>
              </tr>
              <tr v-if="!loading && recentSiteUsage.length === 0">
                <td class="empty" colspan="5">暂无站点统计</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="panel">
        <div class="panel-header">
          <div>
            <h2>模型 token 总量</h2>
            <p class="muted">最近 7 天按模型聚合。</p>
          </div>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>模型</th>
                <th>请求</th>
                <th>成功率</th>
                <th>Token</th>
                <th>平均耗时</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in topModelUsage" :key="item.model">
                <td class="mono">{{ item.model }}</td>
                <td>{{ formatInteger(item.requests) }}</td>
                <td>{{ formatPercent(item.successRate) }}</td>
                <td>{{ formatInteger(item.totalTokens) }}</td>
                <td>{{ Math.round(item.averageLatencyMs) }}ms</td>
              </tr>
              <tr v-if="!loading && topModelUsage.length === 0">
                <td class="empty" colspan="5">暂无模型统计</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </section>
</template>
