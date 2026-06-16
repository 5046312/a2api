<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
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
const rowLoading = reactive<Record<number, boolean>>({});
const filters = reactive({
  type: '',
  level: '',
  read: ''
});

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
  if (!window.confirm('清空全部程序日志？')) return;
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

onMounted(reloadLogs);
</script>

<template>
  <section class="page-stack">
    <div class="panel">
      <div class="panel-header">
        <div>
          <h2>程序日志</h2>
          <p class="muted">共 {{ total }} 条；未读 {{ unreadCount }} 条。</p>
        </div>
        <div class="actions">
          <button class="btn btn-secondary" type="button" :disabled="loading" @click="reloadLogs">刷新</button>
          <button class="btn btn-secondary" type="button" @click="markAllRead">全部已读</button>
          <button class="btn btn-secondary" type="button" @click="clearAll">清空</button>
        </div>
      </div>

      <div class="toolbar">
        <select v-model="filters.type" class="select" @change="reloadLogs">
          <option value="">全部类型</option>
          <option value="proxy">代理</option>
          <option value="balance">余额</option>
          <option value="token">Token</option>
          <option value="account">账号</option>
          <option value="system">系统</option>
          <option value="status">状态</option>
          <option value="site_notice">站点公告</option>
        </select>
        <select v-model="filters.level" class="select" @change="reloadLogs">
          <option value="">全部级别</option>
          <option value="info">信息</option>
          <option value="warning">警告</option>
          <option value="error">错误</option>
        </select>
        <select v-model="filters.read" class="select" @change="reloadLogs">
          <option value="">全部状态</option>
          <option value="false">未读</option>
          <option value="true">已读</option>
        </select>
      </div>

      <p v-if="message" class="notice">{{ message }}</p>
      <p v-if="error" class="error">{{ error }}</p>

      <div class="table-wrap">
        <table class="data-table">
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
              <td><span class="badge" :class="levelClass(item.level)">{{ levelLabel(item.level) }}</span></td>
              <td>{{ item.title }}</td>
              <td class="error-cell">{{ item.message || '-' }}</td>
              <td>
                <span class="badge" :class="eventStatus(item).className">{{ eventStatus(item).label }}</span>
              </td>
              <td>{{ item.relatedType || '-' }} {{ item.relatedId || '' }}</td>
              <td>{{ item.read ? '已读' : '未读' }}</td>
              <td class="actions">
                <button class="text-btn" type="button" :disabled="item.read || rowLoading[item.id]" @click="markRead(item)">
                  {{ rowLoading[item.id] ? '标记中' : '标已读' }}
                </button>
              </td>
            </tr>
            <tr v-if="!loading && events.length === 0">
              <td class="empty" colspan="9">暂无程序日志</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="events.length < total" class="form-actions">
        <button class="btn btn-secondary" type="button" :disabled="loadingMore" @click="loadMore">
          {{ loadingMore ? '加载中' : '加载更多' }}
        </button>
      </div>
    </div>
  </section>
</template>
