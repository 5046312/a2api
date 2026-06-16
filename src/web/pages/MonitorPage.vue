<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { api, type MonitorConfig } from '@web/api';

type MonitorSite = {
  id: string;
  name: string;
  url: string;
  description: string;
  requiresCookie: boolean;
};

const monitorSites: MonitorSite[] = [
  {
    id: 'check-linux-do',
    name: 'check.linux.do',
    url: 'https://check.linux.do',
    description: 'LinuxDo 可用性监控',
    requiresCookie: false
  },
  {
    id: 'ldoh-105117',
    name: 'ldoh.105117.xyz',
    url: 'https://ldoh.105117.xyz',
    description: 'LDOH 监控面板',
    requiresCookie: true
  }
];

const defaultMonitorSite = monitorSites[0] as MonitorSite;
const activeSiteId = ref(defaultMonitorSite.id);
const reloadSeed = ref(0);
const loaded = ref(false);
const showFallbackHint = ref(false);
const loading = ref(false);
const saving = ref(false);
const error = ref('');
const message = ref('');
const cookieInput = ref('');
const monitorConfig = ref<MonitorConfig>({
  ldohCookieConfigured: false,
  ldohCookieMasked: ''
});
let fallbackTimer: number | undefined;

const activeSite = computed(() => monitorSites.find((site) => site.id === activeSiteId.value) || defaultMonitorSite);
const directSiteUrl = computed(() => `${activeSite.value.url.replace(/\/$/, '')}/`);
const usingProxy = computed(() => activeSite.value.id === 'ldoh-105117' && monitorConfig.value.ldohCookieConfigured);
const iframeUrl = computed(() => usingProxy.value ? '/monitor-proxy/ldoh/' : directSiteUrl.value);
const iframeKey = computed(() => `${activeSite.value.id}-${reloadSeed.value}-${usingProxy.value ? 'proxy' : 'direct'}`);
const ldohOauthUrl = computed(() => `${directSiteUrl.value}api/oauth/initiate?returnTo=%2F`);
const fallbackText = computed(() => {
  if (usingProxy.value) return '代理模式已启用；如果仍无法加载，请重新保存 LDOH Cookie。';
  return '当前站点可能禁止 iframe 内嵌，建议使用新窗口打开。';
});

function clearFallbackTimer() {
  if (fallbackTimer !== undefined) window.clearTimeout(fallbackTimer);
  fallbackTimer = undefined;
}

function prepareFrameLoad() {
  clearFallbackTimer();
  loaded.value = false;
  showFallbackHint.value = false;
  fallbackTimer = window.setTimeout(() => {
    if (!loaded.value) showFallbackHint.value = true;
  }, 4500);
}

async function loadMonitorConfig() {
  loading.value = true;
  error.value = '';
  try {
    monitorConfig.value = await api.getMonitorConfig();
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加载监控配置失败';
  } finally {
    loading.value = false;
  }
}

async function initSession() {
  try {
    await api.initMonitorSession();
  } catch {
    // Cookie 代理授权失败时，页面仍可使用外部新窗口访问。
  }
}

async function saveCookie() {
  saving.value = true;
  error.value = '';
  message.value = '';
  try {
    const result = await api.updateMonitorConfig({ ldohCookie: cookieInput.value.trim() || null });
    monitorConfig.value = result;
    cookieInput.value = '';
    message.value = result.message;
    await initSession();
    reloadFrame();
  } catch (err) {
    error.value = err instanceof Error ? err.message : '保存 LDOH Cookie 失败';
  } finally {
    saving.value = false;
  }
}

function selectSite(siteId: string) {
  activeSiteId.value = siteId;
  reloadFrame();
}

function reloadFrame() {
  reloadSeed.value += 1;
  prepareFrameLoad();
  void initSession();
}

function openDirect() {
  window.open(directSiteUrl.value, '_blank', 'noopener,noreferrer');
}

function openOAuth() {
  window.open(ldohOauthUrl.value, '_blank', 'noopener,noreferrer');
}

function openProxy() {
  window.open('/monitor-proxy/ldoh/', '_blank', 'noopener,noreferrer');
}

onMounted(async () => {
  await Promise.all([loadMonitorConfig(), initSession()]);
  prepareFrameLoad();
});

onBeforeUnmount(clearFallbackTimer);
</script>

<template>
  <section class="page-stack">
    <div class="panel">
      <div class="panel-header">
        <div>
          <h2>监控内嵌</h2>
          <p class="muted">在当前后台中查看外部可用性监控页面。</p>
        </div>
        <div class="form-actions">
          <button class="btn btn-secondary" type="button" :disabled="loading" @click="reloadFrame">刷新</button>
          <button class="btn btn-primary" type="button" @click="openDirect">新窗口打开</button>
        </div>
      </div>

      <div class="monitor-tabs">
        <button
          v-for="site in monitorSites"
          :key="site.id"
          class="monitor-tab"
          :class="{ active: site.id === activeSite.id }"
          type="button"
          @click="selectSite(site.id)"
        >
          <strong>{{ site.name }}</strong>
          <span>{{ site.description }}</span>
        </button>
      </div>
    </div>

    <div v-if="activeSite.requiresCookie" class="panel">
      <div class="panel-header">
        <div>
          <h2>LDOH Cookie</h2>
          <p class="muted">保存 ld_auth_session 后可通过同源代理内嵌 LDOH。</p>
        </div>
        <span class="badge" :class="{ active: monitorConfig.ldohCookieConfigured }">
          {{ monitorConfig.ldohCookieConfigured ? '已配置' : '未配置' }}
        </span>
      </div>
      <p v-if="monitorConfig.ldohCookieConfigured" class="muted">当前：{{ monitorConfig.ldohCookieMasked || '已保存' }}</p>
      <div class="form-grid single">
        <label class="field">
          <span>Cookie</span>
          <input v-model="cookieInput" class="input" placeholder="ld_auth_session=..." />
        </label>
        <div class="form-actions">
          <button class="btn btn-primary" type="button" :disabled="saving" @click="saveCookie">
            {{ saving ? '保存中' : cookieInput.trim() ? '保存 Cookie' : '清空 Cookie' }}
          </button>
          <button class="btn btn-secondary" type="button" @click="openOAuth">授权登录</button>
          <button v-if="usingProxy" class="btn btn-secondary" type="button" @click="openProxy">代理新窗口</button>
        </div>
      </div>
    </div>

    <p v-if="message" class="notice">{{ message }}</p>
    <p v-if="error" class="error">{{ error }}</p>

    <div class="panel monitor-frame-panel">
      <p v-if="showFallbackHint && !loaded" class="notice">{{ fallbackText }}</p>
      <iframe
        :key="iframeKey"
        class="monitor-iframe"
        :src="iframeUrl"
        :title="`monitor-${activeSite.id}`"
        @load="loaded = true"
      ></iframe>
    </div>
  </section>
</template>

<style scoped lang="scss">
.monitor-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 16px;
}

.monitor-tab {
  display: flex;
  min-width: 220px;
  flex: 1;
  flex-direction: column;
  gap: 4px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: #ffffff;
  color: #26364b;
  padding: 12px;
  text-align: left;
}

.monitor-tab.active {
  border-color: #176b87;
  background: #e8f4f7;
  color: #0f4c5c;
}

.monitor-tab span {
  color: #65748b;
  font-size: 13px;
}

.monitor-frame-panel {
  min-height: 620px;
}

.monitor-iframe {
  width: 100%;
  height: 640px;
  border: 1px solid #d6dde8;
  border-radius: 8px;
  background: #ffffff;
}
</style>
