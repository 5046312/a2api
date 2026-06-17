<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useMessage } from 'naive-ui';
import { api, type ModelUsageItem, type SiteUsageItem, type StatsOverview } from '@web/api';

const overview = ref<StatsOverview | null>(null);
const siteUsage = ref<SiteUsageItem[]>([]);
const modelUsage = ref<ModelUsageItem[]>([]);
const loading = ref(false);
const error = ref('');
const notice = useMessage();

watch(error, (value) => {
  if (value) notice.error(value);
});

const cards = computed(() => {
  const data = overview.value;
  return [
    { label: '今日请求数', value: data ? formatInteger(data.todayRequests) : '-' },
    { label: '今日成功率', value: data ? formatPercent(data.todaySuccessRate) : '-' },
    { label: '今日用量', value: data ? formatInteger(data.todayTokens) : '-' },
    { label: '今日费用', value: data ? formatCost(data.todayCost) : '-' },
    { label: '活跃上游数', value: data ? formatInteger(data.activeSiteCount) : '-' },
    { label: '异常上游账号', value: data ? formatInteger(data.abnormalAccountCount) : '-' }
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
    <n-card title="运行总览" :bordered="false">
      <template #header-extra>
        <n-button secondary :loading="loading" @click="loadOverview">刷新</n-button>
      </template>
      <p class="muted">今日统计按服务端本地日期计算。</p>
      <n-grid class="stats-grid" :cols="3" :x-gap="12" :y-gap="12" responsive="screen">
        <n-gi v-for="card in cards" :key="card.label">
          <n-card class="stat-card" size="small" :bordered="false">
            <n-statistic :label="card.label" :value="card.value" />
          </n-card>
        </n-gi>
      </n-grid>
    </n-card>

    <div class="two-column">
      <n-card title="上游调用趋势" :bordered="false">
        <p class="muted">最近 7 天按天聚合。</p>
        <div class="table-wrap">
          <n-table size="small" :bordered="false" single-line class="admin-table">
            <thead>
              <tr>
                <th>日期</th>
                <th>上游</th>
                <th>请求</th>
                <th>成功率</th>
                <th>用量</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in recentSiteUsage" :key="`${item.bucket}-${item.siteId || 0}`">
                <td class="mono">{{ item.bucket }}</td>
                <td>{{ item.siteName || '未知上游' }}</td>
                <td>{{ formatInteger(item.requests) }}</td>
                <td>{{ formatPercent(item.successRate) }}</td>
                <td>{{ formatInteger(item.totalTokens) }}</td>
              </tr>
              <tr v-if="!loading && recentSiteUsage.length === 0">
                <td class="empty" colspan="5">暂无上游统计</td>
              </tr>
            </tbody>
          </n-table>
        </div>
      </n-card>

      <n-card title="模型用量总量" :bordered="false">
        <p class="muted">最近 7 天按模型聚合。</p>
        <div class="table-wrap">
          <n-table size="small" :bordered="false" single-line class="admin-table">
            <thead>
              <tr>
                <th>模型</th>
                <th>请求</th>
                <th>成功率</th>
                <th>用量</th>
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
          </n-table>
        </div>
      </n-card>
    </div>
  </section>
</template>
