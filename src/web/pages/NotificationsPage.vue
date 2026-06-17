<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api, type NotificationSettings } from '@web/api';

const settings = ref<NotificationSettings | null>(null);
const loading = ref(false);
const saving = ref(false);
const error = ref('');
const message = ref('');
const form = reactive({
  webhookEnabled: false,
  webhookUrl: '',
  clearWebhookUrl: false,
  notifyCooldownSec: 300
});

const rows = computed(() => [
  {
    label: 'Webhook 状态',
    value: settings.value?.webhookEnabled ? '已启用' : '未启用',
    note: settings.value?.webhookUrlMasked || '未配置 Webhook URL'
  },
  {
    label: '通知冷静期',
    value: `${settings.value?.notifyCooldownSec ?? form.notifyCooldownSec} 秒`,
    note: '避免同类异常高频发送通知。'
  }
]);

function syncForm(snapshot: NotificationSettings) {
  form.webhookEnabled = snapshot.webhookEnabled;
  form.webhookUrl = '';
  form.clearWebhookUrl = false;
  form.notifyCooldownSec = snapshot.notifyCooldownSec;
}

function buildPayload() {
  const payload: Record<string, unknown> = {
    webhookEnabled: form.webhookEnabled,
    clearWebhookUrl: form.clearWebhookUrl,
    notifyCooldownSec: Math.max(0, Math.trunc(Number(form.notifyCooldownSec) || 0))
  };
  const webhookUrl = form.webhookUrl.trim();
  if (webhookUrl) payload.webhookUrl = webhookUrl;
  return payload;
}

async function loadSettings() {
  loading.value = true;
  error.value = '';
  message.value = '';
  try {
    settings.value = await api.getNotificationSettings();
    syncForm(settings.value);
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加载通知设置失败';
  } finally {
    loading.value = false;
  }
}

async function saveSettings() {
  saving.value = true;
  error.value = '';
  message.value = '';
  try {
    settings.value = await api.updateNotificationSettings(buildPayload());
    syncForm(settings.value);
    message.value = '通知设置已保存';
  } catch (err) {
    error.value = err instanceof Error ? err.message : '保存通知设置失败';
  } finally {
    saving.value = false;
  }
}

async function sendTest() {
  saving.value = true;
  error.value = '';
  message.value = '';
  try {
    settings.value = await api.updateNotificationSettings(buildPayload());
    syncForm(settings.value);
    const result = await api.testNotifications();
    message.value = result.message;
  } catch (err) {
    error.value = err instanceof Error ? err.message : '测试通知失败';
  } finally {
    saving.value = false;
  }
}

onMounted(loadSettings);
</script>

<template>
  <section class="page-stack">
    <n-card class="admin-card" :bordered="false">
      <div class="panel-header">
        <div>
          <h2>通知设置</h2>
          <p class="muted">当前支持通用 Webhook，敏感地址只返回脱敏值。</p>
        </div>
        <n-button secondary attr-type="button" :disabled="loading" @click="loadSettings">
          {{ loading ? '刷新中' : '刷新' }}
        </n-button>
      </div>

      <form class="form-grid single" @submit.prevent="saveSettings">
        <label class="check-row">
          <n-checkbox v-model:checked="form.webhookEnabled">启用 Webhook 通知</n-checkbox>
        </label>
        <label class="field">
          <span>Webhook URL</span>
          <n-input v-model:value="form.webhookUrl" placeholder="留空保留已保存地址" />
        </label>
        <label class="check-row">
          <n-checkbox v-model:checked="form.clearWebhookUrl">清空已保存 Webhook URL</n-checkbox>
        </label>
        <label class="field">
          <span>通知冷静期（秒）</span>
          <n-input-number v-model:value="form.notifyCooldownSec" :min="0" />
        </label>
        <div class="form-actions">
          <n-button type="primary" attr-type="submit" :disabled="saving">{{ saving ? '保存中' : '保存设置' }}</n-button>
          <n-button secondary attr-type="button" :disabled="saving" @click="sendTest">测试通知</n-button>
        </div>
      </form>

      <n-alert v-if="message" type="success" :bordered="false">{{ message }}</n-alert>
      <n-alert v-if="error" type="error" :bordered="false">{{ error }}</n-alert>
    </n-card>

    <n-card class="admin-card" :bordered="false">
      <div class="panel-header">
        <div>
          <h2>当前状态</h2>
          <p class="muted">运行时配置保存后立即生效。</p>
        </div>
      </div>
      <div v-if="loading" class="empty">加载中</div>
      <div v-else class="settings-grid">
        <article v-for="row in rows" :key="row.label" class="setting-item">
          <span class="setting-label">{{ row.label }}</span>
          <strong class="setting-value">{{ row.value }}</strong>
          <span class="setting-note">{{ row.note }}</span>
        </article>
      </div>
    </n-card>
  </section>
</template>
