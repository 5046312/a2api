<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { api, type EventItem } from '@web/api';

const events = ref<EventItem[]>([]);
const unreadCount = ref(0);
const loading = ref(false);
const error = ref('');
const message = ref('');
const filters = reactive({
  type: '',
  level: '',
  read: ''
});

function setError(err: unknown, fallback: string) {
  error.value = err instanceof Error ? err.message : fallback;
}

function readQueryValue() {
  if (filters.read === 'true') return true;
  if (filters.read === 'false') return false;
  return undefined;
}

async function loadEvents() {
  loading.value = true;
  error.value = '';
  try {
    const [eventData, countData] = await Promise.all([
      api.listEvents({
        pageSize: 50,
        type: filters.type,
        level: filters.level,
        read: readQueryValue()
      }),
      api.getEventCount()
    ]);
    events.value = eventData.items;
    unreadCount.value = countData.count;
  } catch (err) {
    setError(err, '加载事件失败');
  } finally {
    loading.value = false;
  }
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
    await loadEvents();
  } catch (err) {
    setError(err, '标记全部失败');
  }
}

async function clearAll() {
  if (!window.confirm('清空全部事件？')) return;
  error.value = '';
  message.value = '';
  try {
    const result = await api.clearEvents();
    message.value = `已清空 ${result.deleted} 条事件`;
    await loadEvents();
  } catch (err) {
    setError(err, '清空事件失败');
  }
}

onMounted(loadEvents);
</script>

<template>
  <section class="page-stack">
    <div class="panel">
      <div class="panel-header">
        <div>
          <h2>系统事件</h2>
          <p class="muted">未读 {{ unreadCount }} 条；用于查看通道冷却、代理失败等运行事件。</p>
        </div>
        <div class="actions">
          <button class="btn btn-secondary" type="button" @click="loadEvents">刷新</button>
          <button class="btn btn-secondary" type="button" @click="markAllRead">全部已读</button>
          <button class="btn btn-secondary" type="button" @click="clearAll">清空</button>
        </div>
      </div>
      <div class="toolbar">
        <select v-model="filters.type" class="select" @change="loadEvents">
          <option value="">全部类型</option>
          <option value="proxy">代理</option>
          <option value="system">系统</option>
          <option value="account">账号</option>
        </select>
        <select v-model="filters.level" class="select" @change="loadEvents">
          <option value="">全部级别</option>
          <option value="info">Info</option>
          <option value="warning">Warning</option>
          <option value="error">Error</option>
        </select>
        <select v-model="filters.read" class="select" @change="loadEvents">
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
              <th>关联</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in events" :key="item.id">
              <td class="mono">{{ item.createdAt }}</td>
              <td>{{ item.type }}</td>
              <td><span class="badge" :class="item.level">{{ item.level }}</span></td>
              <td>{{ item.title }}</td>
              <td class="error-cell">{{ item.message || '-' }}</td>
              <td>{{ item.relatedType || '-' }} {{ item.relatedId || '' }}</td>
              <td>{{ item.read ? '已读' : '未读' }}</td>
              <td class="actions">
                <button class="text-btn" type="button" :disabled="item.read" @click="markRead(item)">标已读</button>
              </td>
            </tr>
            <tr v-if="!loading && events.length === 0">
              <td class="empty" colspan="8">暂无事件</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>
