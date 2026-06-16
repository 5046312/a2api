<script setup lang="ts">
import { ref } from 'vue';
import { api } from '@web/api';
import { clearAdminToken, setAdminToken } from '@web/authSession';

const emit = defineEmits<{
  authed: [];
}>();

const token = ref('');
const loading = ref(false);
const error = ref('');

async function submit() {
  const value = token.value.trim();
  if (!value) {
    error.value = '请输入管理 Token';
    return;
  }
  loading.value = true;
  error.value = '';
  setAdminToken(value);
  try {
    await api.authCheck();
    emit('authed');
  } catch (err) {
    clearAdminToken();
    error.value = err instanceof Error ? err.message : '登录失败';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <main class="login-screen">
    <form class="login-panel" @submit.prevent="submit">
      <div>
        <p class="eyebrow">a2api</p>
        <h1>管理后台</h1>
        <p class="muted">输入服务端配置的管理 Token。</p>
      </div>
      <label class="field">
        <span>管理 Token</span>
        <input v-model="token" class="input" type="password" autocomplete="current-password" />
      </label>
      <p v-if="error" class="error">{{ error }}</p>
      <button class="btn btn-primary" type="submit" :disabled="loading">
        {{ loading ? '验证中' : '进入后台' }}
      </button>
    </form>
  </main>
</template>
