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
    <div class="panel">
      <div class="panel-header">
        <div>
          <h2>通知设置</h2>
          <p class="muted">当前支持通用 Webhook，敏感地址只返回脱敏值。</p>
        </div>
        <button class="btn btn-secondary" type="button" :disabled="loading" @click="loadSettings">
          {{ loading ? '刷新中' : '刷新' }}
        </button>
      </div>

      <form class="form-grid single" @submit.prevent="saveSettings">
        <label class="check-row">
          <input v-model="form.webhookEnabled" type="checkbox" />
          <span>启用 Webhook 通知</span>
        </label>
        <label class="field">
          <span>Webhook URL</span>
          <input v-model="form.webhookUrl" class="input" placeholder="留空保留已保存地址" />
        </label>
        <label class="check-row">
          <input v-model="form.clearWebhookUrl" type="checkbox" />
          <span>清空已保存 Webhook URL</span>
        </label>
        <label class="field">
          <span>通知冷静期（秒）</span>
          <input v-model.number="form.notifyCooldownSec" class="input" min="0" type="number" />
        </label>
        <div class="form-actions">
          <button class="btn btn-primary" type="submit" :disabled="saving">{{ saving ? '保存中' : '保存设置' }}</button>
          <button class="btn btn-secondary" type="button" :disabled="saving" @click="sendTest">测试通知</button>
        </div>
      </form>

      <p v-if="message" class="notice">{{ message }}</p>
      <p v-if="error" class="error">{{ error }}</p>
    </div>

    <div class="panel">
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
    </div>
  </section>
</template>
