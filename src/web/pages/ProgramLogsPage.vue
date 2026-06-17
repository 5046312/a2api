<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useDialog } from 'naive-ui';
import { api, type EventItem } from '@web/api';

const PAGE_SIZE = 50;

const events = ref<EventItem[]>([]);
const total = ref(0);
const unreadCount = ref(0);
const page = ref(1);
const loading = ref(false);
const loadingMore = ref(false);
const error = ref('');
const message = ref('');
const dialog = useDialog();
const rowLoading = reactive<Record<number, boolean>>({});
const filters = reactive({
  type: '',
  level: '',
  read: ''
});
const logTypeOptions = [
  { label: '全部类型', value: '' },
  { label: '代理', value: 'proxy' },
  { label: '余额', value: 'balance' },
  { label: '凭据', value: 'token' },
  { label: '账号', value: 'account' },
  { label: '系统', value: 'system' },
  { label: '状态', value: 'status' },
  { label: '上游公告', value: 'site_notice' }
];
const logLevelOptions = [
  { label: '全部级别', value: '' },
  { label: '信息', value: 'info' },
  { label: '警告', value: 'warning' },
  { label: '错误', value: 'error' }
];
const readOptions = [
  { label: '全部状态', value: '' },
  { label: '未读', value: 'false' },
  { label: '已读', value: 'true' }
];

function setError(err: unknown, fallback: string) {
  error.value = err instanceof Error ? err.message : fallback;
}

function readQueryValue() {
  if (filters.read === 'false') return false;
  if (filters.read === 'true') return true;
  return undefined;
}

function levelLabel(level: string) {
  if (level === 'error') return '错误';
  if (level === 'warning') return '警告';
  return '信息';
}

function levelClass(level: string) {
  if (level === 'error') return 'failed';
  if (level === 'warning') return 'retried';
  return 'active';
}

function tagTypeByClass(className: string) {
  if (className === 'failed') return 'error';
  if (className === 'retried') return 'warning';
  if (className === 'success' || className === 'active') return 'success';
  return 'default';
}

function eventStatus(item: EventItem) {
  const text = `${item.title} ${item.message || ''}`.toLowerCase();
  if (text.includes('失败') || text.includes('failed') || text.includes('error')) return { label: '失败', className: 'failed' };
  if (text.includes('跳过') || text.includes('skipped')) return { label: '跳过', className: 'retried' };
  if (text.includes('成功') || text.includes('完成') || text.includes('completed') || text.includes('finished')) {
    return { label: '成功', className: 'success' };
  }
  if (item.level === 'error') return { label: '异常', className: 'failed' };
  if (item.level === 'warning') return { label: '警告', className: 'retried' };
  return { label: '信息', className: 'active' };
}

async function loadLogs(nextPage = 1, append = false) {
  if (append) loadingMore.value = true;
  else loading.value = true;
  error.value = '';
  try {
    const [eventData, countData] = await Promise.all([
      api.listEvents({
        page: nextPage,
        pageSize: PAGE_SIZE,
        type: filters.type,
        level: filters.level,
        read: readQueryValue()
      }),
      api.getEventCount()
    ]);
    page.value = nextPage;
    total.value = eventData.total;
    unreadCount.value = countData.count;
    events.value = append ? [...events.value, ...eventData.items] : eventData.items;
  } catch (err) {
    setError(err, '加载程序日志失败');
  } finally {
    loading.value = false;
    loadingMore.value = false;
  }
}

function reloadLogs() {
  return loadLogs(1, false);
}

async function loadMore() {
  await loadLogs(page.value + 1, true);
}

async function markRead(item: EventItem) {
  error.value = '';
  message.value = '';
  rowLoading[item.id] = true;
  try {
    await api.markEventRead(item.id);
    message.value = '日志已标记为已读';
    if (filters.read === 'false') {
      events.value = events.value.filter((row) => row.id !== item.id);
      total.value = Math.max(0, total.value - 1);
      unreadCount.value = Math.max(0, unreadCount.value - 1);
    } else {
      item.read = true;
      unreadCount.value = Math.max(0, unreadCount.value - 1);
    }
  } catch (err) {
    setError(err, '标记日志失败');
  } finally {
    rowLoading[item.id] = false;
  }
}

async function markAllRead() {
  error.value = '';
  message.value = '';
  try {
    const result = await api.markAllEventsRead();
    message.value = `已标记 ${result.updated} 条日志`;
    await reloadLogs();
  } catch (err) {
    setError(err, '标记全部失败');
  }
}

async function clearAll() {
  dialog.warning({
    title: '确认操作',
    content: '清空全部程序日志？',
    positiveText: '确认',
    negativeText: '取消',
    onPositiveClick: async () => {
      error.value = '';
      message.value = '';
      try {
        const result = await api.clearEvents();
        message.value = `已清空 ${result.deleted} 条日志`;
        await reloadLogs();
      } catch (err) {
        setError(err, '清空日志失败');
      }
    }
  });
}

onMounted(reloadLogs);
</script>

<template>
  <section class="page-stack">
    <n-card class="admin-card" :bordered="false">
      <div class="panel-header">
        <div>
          <h2>程序日志</h2>
          <p class="muted">共 {{ total }} 条；未读 {{ unreadCount }} 条。</p>
        </div>
        <div class="actions">
          <n-button secondary attr-type="button" :disabled="loading" @click="reloadLogs">刷新</n-button>
          <n-button secondary attr-type="button" @click="markAllRead">全部已读</n-button>
          <n-button secondary attr-type="button" @click="clearAll">清空</n-button>
        </div>
      </div>

      <div class="toolbar">
        <n-select v-model:value="filters.type" :options="logTypeOptions" class="toolbar-select" @update:value="reloadLogs" />
        <n-select v-model:value="filters.level" :options="logLevelOptions" class="toolbar-select" @update:value="reloadLogs" />
        <n-select v-model:value="filters.read" :options="readOptions" class="toolbar-select" @update:value="reloadLogs" />
      </div>

      <n-alert v-if="message" type="success" :bordered="false">{{ message }}</n-alert>
      <n-alert v-if="error" type="error" :bordered="false">{{ error }}</n-alert>

      <div class="table-wrap">
        <n-table size="small" :bordered="false" single-line class="admin-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>类型</th>
              <th>级别</th>
              <th>标题</th>
              <th>内容</th>
              <th>结果</th>
              <th>关联</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in events" :key="item.id">
              <td class="mono">{{ item.createdAt }}</td>
              <td>{{ item.type }}</td>
              <td>
                <n-tag size="small" :type="tagTypeByClass(levelClass(item.level))">{{ levelLabel(item.level) }}</n-tag>
              </td>
              <td>{{ item.title }}</td>
              <td class="error-cell">{{ item.message || '-' }}</td>
              <td>
                <n-tag size="small" :type="tagTypeByClass(eventStatus(item).className)">
                  {{ eventStatus(item).label }}
                </n-tag>
              </td>
              <td>{{ item.relatedType || '-' }} {{ item.relatedId || '' }}</td>
              <td>{{ item.read ? '已读' : '未读' }}</td>
              <td class="actions">
                <n-button text attr-type="button" :disabled="item.read || rowLoading[item.id]" @click="markRead(item)">
                  {{ rowLoading[item.id] ? '标记中' : '标已读' }}
                </n-button>
              </td>
            </tr>
            <tr v-if="!loading && events.length === 0">
              <td class="empty" colspan="9">暂无程序日志</td>
            </tr>
          </tbody>
        </n-table>
      </div>

      <div v-if="events.length < total" class="form-actions">
        <n-button secondary attr-type="button" :disabled="loadingMore" @click="loadMore">
          {{ loadingMore ? '加载中' : '加载更多' }}
        </n-button>
      </div>
    </n-card>
  </section>
</template>
