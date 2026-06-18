<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue';
import { useDialog, useMessage } from 'naive-ui';
import { api, type EventItem } from '@web/api';

const PAGE_SIZE = 50;

const events = ref<EventItem[]>([]);
const total = ref(0);
const page = ref(1);
const unreadCount = ref(0);
const loading = ref(false);
const error = ref('');
const message = ref('');
const dialog = useDialog();
const notice = useMessage();
const filters = reactive({
  type: '',
  level: '',
  read: ''
});
const eventTypeOptions = [
  { label: '全部类型', value: '' },
  { label: '代理', value: 'proxy' },
  { label: '系统', value: 'system' },
  { label: '账号', value: 'account' }
];

watch(message, (value) => {
  if (value) notice.success(value);
});

watch(error, (value) => {
  if (value) notice.error(value);
});
const eventLevelOptions = [
  { label: '全部级别', value: '' },
  { label: 'Info', value: 'info' },
  { label: 'Warning', value: 'warning' },
  { label: 'Error', value: 'error' }
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
  if (filters.read === 'true') return true;
  if (filters.read === 'false') return false;
  return undefined;
}

function eventLevelTagType(level: string) {
  if (level === 'error') return 'error';
  if (level === 'warning') return 'warning';
  return 'info';
}

async function loadEvents() {
  loading.value = true;
  error.value = '';
  try {
    const [eventData, countData] = await Promise.all([
      api.listEvents({
        page: page.value,
        pageSize: PAGE_SIZE,
        type: filters.type,
        level: filters.level,
        read: readQueryValue()
      }),
      api.getEventCount()
    ]);
    events.value = eventData.items;
    total.value = eventData.total;
    unreadCount.value = countData.count;
  } catch (err) {
    setError(err, '加载事件失败');
  } finally {
    loading.value = false;
  }
}

function reloadEvents() {
  page.value = 1;
  return loadEvents();
}

async function handlePageChange(nextPage: number) {
  page.value = nextPage;
  await loadEvents();
}

async function markRead(item: EventItem) {
  error.value = '';
  message.value = '';
  try {
    await api.markEventRead(item.id);
    message.value = '事件已标记为已读';
    await loadEvents();
  } catch (err) {
    setError(err, '标记事件失败');
  }
}

async function markAllRead() {
  error.value = '';
  message.value = '';
  try {
    const result = await api.markAllEventsRead();
    message.value = `已标记 ${result.updated} 条事件`;
    await reloadEvents();
  } catch (err) {
    setError(err, '标记全部失败');
  }
}

async function clearAll() {
  dialog.warning({
    title: '确认操作',
    content: '清空全部事件？',
    positiveText: '确认',
    negativeText: '取消',
    onPositiveClick: async () => {
      error.value = '';
      message.value = '';
      try {
        const result = await api.clearEvents();
        message.value = `已清空 ${result.deleted} 条事件`;
        await reloadEvents();
      } catch (err) {
        setError(err, '清空事件失败');
      }
    }
  });
}

onMounted(loadEvents);
</script>

<template>
  <section class="page-stack">
    <n-card class="admin-card" :bordered="false">
      <div class="panel-header">
        <div>
          <h2>系统事件</h2>
          <p class="muted">共 {{ total }} 条；未读 {{ unreadCount }} 条；用于查看通道冷却、代理失败等运行事件。</p>
        </div>
        <div class="actions">
          <n-button secondary attr-type="button" @click="reloadEvents">刷新</n-button>
          <n-button secondary attr-type="button" @click="markAllRead">全部已读</n-button>
          <n-button secondary attr-type="button" @click="clearAll">清空</n-button>
        </div>
      </div>
      <div class="toolbar">
        <n-select v-model:value="filters.type" :options="eventTypeOptions" class="toolbar-select" @update:value="reloadEvents" />
        <n-select v-model:value="filters.level" :options="eventLevelOptions" class="toolbar-select" @update:value="reloadEvents" />
        <n-select v-model:value="filters.read" :options="readOptions" class="toolbar-select" @update:value="reloadEvents" />
      </div>
      <div class="table-wrap">
        <n-table size="small" :bordered="false" single-line class="admin-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>类型</th>
              <th>级别</th>
              <th>标题</th>
              <th>内容</th>
              <th>关联</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in events" :key="item.id">
              <td class="mono">{{ item.createdAt }}</td>
              <td>{{ item.type }}</td>
              <td><n-tag size="small" :type="eventLevelTagType(item.level)">{{ item.level }}</n-tag></td>
              <td>{{ item.title }}</td>
              <td class="error-cell">{{ item.message || '-' }}</td>
              <td>{{ item.relatedType || '-' }} {{ item.relatedId || '' }}</td>
              <td>{{ item.read ? '已读' : '未读' }}</td>
              <td class="actions">
                <n-button text attr-type="button" :disabled="item.read" @click="markRead(item)">标已读</n-button>
              </td>
            </tr>
            <tr v-if="!loading && events.length === 0">
              <td class="empty" colspan="8">暂无事件</td>
            </tr>
          </tbody>
        </n-table>
      </div>
      <div class="pagination-wrap">
        <n-pagination
          :page="page"
          :page-size="PAGE_SIZE"
          :item-count="total"
          @update:page="handlePageChange"
        />
      </div>
    </n-card>
  </section>
</template>

<style scoped lang="scss">
.pagination-wrap {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}
</style>
