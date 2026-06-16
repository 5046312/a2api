<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '@web/api';
import { clearAdminToken, getAdminToken } from '@web/authSession';
import AboutPage from '@pages/AboutPage.vue';
import AccountsPage from '@pages/AccountsPage.vue';
import DashboardPage from '@pages/DashboardPage.vue';
import DownstreamKeysPage from '@pages/DownstreamKeysPage.vue';
import EventsPage from '@pages/EventsPage.vue';
import ImportExportPage from '@pages/ImportExportPage.vue';
import LoginPage from '@pages/LoginPage.vue';
import ModelTesterPage from '@pages/ModelTesterPage.vue';
import ModelsPage from '@pages/ModelsPage.vue';
import MonitorPage from '@pages/MonitorPage.vue';
import NotificationsPage from '@pages/NotificationsPage.vue';
import OAuthPage from '@pages/OAuthPage.vue';
import ProgramLogsPage from '@pages/ProgramLogsPage.vue';
import ProxyLogsPage from '@pages/ProxyLogsPage.vue';
import RoutesPage from '@pages/RoutesPage.vue';
import SettingsPage from '@pages/SettingsPage.vue';
import SitesPage from '@pages/SitesPage.vue';

type PageKey =
  | 'dashboard'
  | 'sites'
  | 'accounts'
  | 'routes'
  | 'downstreamKeys'
  | 'proxyLogs'
  | 'programLogs'
  | 'models'
  | 'modelTester'
  | 'monitor'
  | 'events'
  | 'notifications'
  | 'settings'
  | 'oauth'
  | 'importExport'
  | 'about';

const authed = ref(Boolean(getAdminToken()));
const page = ref<PageKey>('dashboard');
const booting = ref(true);

const navItems: Array<{ key: PageKey; label: string; mark: string }> = [
  { key: 'dashboard', label: '仪表盘', mark: 'D' },
  { key: 'sites', label: '站点', mark: 'S' },
  { key: 'accounts', label: '连接', mark: 'A' },
  { key: 'routes', label: '路由', mark: 'R' },
  { key: 'downstreamKeys', label: '密钥', mark: 'K' },
  { key: 'proxyLogs', label: '日志', mark: 'L' },
  { key: 'programLogs', label: '程序日志', mark: 'P' },
  { key: 'models', label: '模型', mark: 'M' },
  { key: 'modelTester', label: '操练场', mark: 'T' },
  { key: 'monitor', label: '监控', mark: 'V' },
  { key: 'events', label: '事件', mark: 'E' },
  { key: 'notifications', label: '通知', mark: 'N' },
  { key: 'settings', label: '设置', mark: 'G' },
  { key: 'oauth', label: 'OAuth', mark: 'O' },
  { key: 'importExport', label: '导入导出', mark: 'I' },
  { key: 'about', label: '关于', mark: 'B' }
];

const currentTitle = computed(() => navItems.find((item) => item.key === page.value)?.label || '仪表盘');

onMounted(async () => {
  if (!getAdminToken()) {
    authed.value = false;
    booting.value = false;
    return;
  }
  try {
    await api.authCheck();
    authed.value = true;
  } catch {
    authed.value = false;
  } finally {
    booting.value = false;
  }
});

function handleAuthed() {
  authed.value = true;
  page.value = 'dashboard';
}

function logout() {
  clearAdminToken();
  authed.value = false;
}
</script>

<template>
  <div v-if="booting" class="min-h-screen bg-slate-100 p-6 text-slate-700">加载中</div>
  <LoginPage v-else-if="!authed" @authed="handleAuthed" />
  <div v-else class="app-shell">
    <aside class="sidebar">
      <div class="brand">
        <span class="brand-mark">A2</span>
        <span>a2api</span>
      </div>
      <nav class="nav">
        <button
          v-for="item in navItems"
          :key="item.key"
          class="nav-item"
          :class="{ active: page === item.key }"
          type="button"
          @click="page = item.key"
        >
          <span class="nav-mark">{{ item.mark }}</span>
          <span>{{ item.label }}</span>
        </button>
      </nav>
      <button class="nav-item logout" type="button" @click="logout">
        <span class="nav-mark">Q</span>
        <span>退出</span>
      </button>
    </aside>
    <main class="content">
      <header class="content-header">
        <div>
          <p class="eyebrow">管理后台</p>
          <h1>{{ currentTitle }}</h1>
        </div>
        <div class="content-actions">
          <span class="status-dot"></span>
          <span>已连接</span>
        </div>
      </header>
      <DashboardPage v-if="page === 'dashboard'" />
      <SitesPage v-else-if="page === 'sites'" />
      <AccountsPage v-else-if="page === 'accounts'" />
      <RoutesPage v-else-if="page === 'routes'" />
      <DownstreamKeysPage v-else-if="page === 'downstreamKeys'" />
      <ProxyLogsPage v-else-if="page === 'proxyLogs'" />
      <ProgramLogsPage v-else-if="page === 'programLogs'" />
      <ModelsPage v-else-if="page === 'models'" />
      <ModelTesterPage v-else-if="page === 'modelTester'" />
      <MonitorPage v-else-if="page === 'monitor'" />
      <EventsPage v-else-if="page === 'events'" />
      <NotificationsPage v-else-if="page === 'notifications'" />
      <SettingsPage v-else-if="page === 'settings'" />
      <OAuthPage v-else-if="page === 'oauth'" />
      <ImportExportPage v-else-if="page === 'importExport'" />
      <AboutPage v-else-if="page === 'about'" />
    </main>
  </div>
</template>
