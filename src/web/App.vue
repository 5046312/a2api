<script setup lang="ts">
import { computed, h, onMounted, ref, type Component } from 'vue';
import { dateZhCN, NIcon, zhCN, type MenuOption } from 'naive-ui';
import {
  AlertCircleOutline,
  CloudUploadOutline,
  CubeOutline,
  DocumentTextOutline,
  FlaskOutline,
  GitBranchOutline,
  InformationCircleOutline,
  KeyOutline,
  KeypadOutline,
  ListOutline,
  NotificationsOutline,
  PeopleOutline,
  PulseOutline,
  SettingsOutline,
  StatsChartOutline
} from '@vicons/ionicons5';
import { api } from '@web/api';
import { clearAdminToken, getAdminToken } from '@web/authSession';
import { naiveThemeOverrides } from '@web/naiveTheme';
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

type PageKey =
  | 'dashboard'
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

const navItems: Array<{ key: PageKey; label: string; icon: Component }> = [
  { key: 'dashboard', label: '仪表盘', icon: StatsChartOutline },
  { key: 'accounts', label: '账号', icon: PeopleOutline },
  { key: 'routes', label: '路由', icon: GitBranchOutline },
  { key: 'downstreamKeys', label: '密钥', icon: KeyOutline },
  { key: 'proxyLogs', label: '日志', icon: DocumentTextOutline },
  { key: 'programLogs', label: '程序日志', icon: ListOutline },
  { key: 'models', label: '模型', icon: CubeOutline },
  { key: 'modelTester', label: '操练场', icon: FlaskOutline },
  { key: 'monitor', label: '监控', icon: PulseOutline },
  { key: 'events', label: '事件', icon: AlertCircleOutline },
  { key: 'notifications', label: '通知', icon: NotificationsOutline },
  { key: 'settings', label: '设置', icon: SettingsOutline },
  { key: 'oauth', label: 'OAuth', icon: KeypadOutline },
  { key: 'importExport', label: '导入导出', icon: CloudUploadOutline },
  { key: 'about', label: '关于', icon: InformationCircleOutline }
];

const currentTitle = computed(() => navItems.find((item) => item.key === page.value)?.label || '仪表盘');
const menuOptions = computed<MenuOption[]>(() =>
  navItems.map((item) => ({
    key: item.key,
    label: item.label,
    icon: () => h(NIcon, { size: 18 }, { default: () => h(item.icon) })
  }))
);

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
  <n-config-provider :theme-overrides="naiveThemeOverrides" :locale="zhCN" :date-locale="dateZhCN">
    <n-dialog-provider>
      <n-message-provider>
        <n-notification-provider>
          <n-loading-bar-provider>
            <div v-if="booting" class="boot-screen">
              <n-spin size="small" />
              <span>加载中</span>
            </div>
            <LoginPage v-else-if="!authed" @authed="handleAuthed" />
            <n-layout v-else has-sider class="app-shell">
              <n-layout-sider
                bordered
                collapse-mode="width"
                :collapsed-width="72"
                :width="244"
                class="app-sider"
              >
                <div class="brand">
                  <span class="brand-mark">A2</span>
                  <span>a2api</span>
                </div>
                <n-menu v-model:value="page" :options="menuOptions" :root-indent="18" :indent="12" />
                <div class="sider-footer">
                  <n-button block secondary type="error" @click="logout">
                    退出
                  </n-button>
                </div>
              </n-layout-sider>
              <n-layout class="app-main">
                <n-layout-header bordered class="content-header">
                  <div>
                    <p class="eyebrow">管理后台</p>
                    <h1>{{ currentTitle }}</h1>
                  </div>
                  <n-tag type="success" size="small" round>已连接</n-tag>
                </n-layout-header>
                <n-layout-content class="content">
                  <DashboardPage v-if="page === 'dashboard'" />
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
                </n-layout-content>
              </n-layout>
            </n-layout>
          </n-loading-bar-provider>
        </n-notification-provider>
      </n-message-provider>
    </n-dialog-provider>
  </n-config-provider>
</template>
