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
    <n-card class="login-panel" :bordered="false">
      <n-form @submit.prevent="submit">
        <n-space vertical :size="16">
          <div>
            <p class="eyebrow">a2api</p>
            <h1>管理后台</h1>
            <p class="muted">输入服务端环境变量 <span class="mono">AUTH_TOKEN</span> 配置的管理 Token。</p>
          </div>
          <n-alert type="info" :bordered="false">
            配置位置：<span class="mono">a2api/.env</span> 或启动环境变量。未配置时开发默认值为
            <span class="mono">change-me-admin-token</span>；复制 <span class="mono">.env.example</span> 后以其中的
            <span class="mono">AUTH_TOKEN</span> 为准，生产环境必须修改。
          </n-alert>
          <n-form-item label="管理 Token" :show-feedback="false">
            <n-input v-model:value="token" type="password" autocomplete="current-password" show-password-on="mousedown" />
          </n-form-item>
          <n-alert v-if="error" type="error" :bordered="false">{{ error }}</n-alert>
          <n-button type="primary" attr-type="submit" :loading="loading" block>
            进入后台
          </n-button>
        </n-space>
      </n-form>
    </n-card>
  </main>
</template>
