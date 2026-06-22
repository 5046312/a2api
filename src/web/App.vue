<script setup lang="ts">
import { computed, h, onMounted, ref, watch, type Component } from 'vue';
import { createDiscreteApi, dateZhCN, NIcon, zhCN, type MenuOption } from 'naive-ui';
import { storeToRefs } from 'pinia';
import { RouterView, useRoute, useRouter } from 'vue-router';
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
  NotificationsOutline,
  PeopleOutline,
  PulseOutline,
  SettingsOutline,
  StatsChartOutline
} from '@vicons/ionicons5';
import { naiveThemeOverrides } from '@web/naiveTheme';
import { api } from '@web/api';
import { setCostDisplayDigits } from '@web/costDisplay';
import { adminRoutes, routeNameFromValue, type AdminRouteName } from '@web/router';
import { useAdminSessionStore } from '@web/stores/adminSession';

const route = useRoute();
const router = useRouter();
const session = useAdminSessionStore();
const { authed, booted } = storeToRefs(session);
const { message } = createDiscreteApi(['message']);
const backendConnected = ref(false);
// 管理端和代理服务同源部署；本地开发时 Vite 代理同样支持该地址调用。
const serviceBaseUrl = computed(() => window.location.origin);

const navIcons: Record<AdminRouteName, Component> = {
  dashboard: StatsChartOutline,
  accounts: PeopleOutline,
  routes: GitBranchOutline,
  downstreamKeys: KeyOutline,
  proxyLogs: DocumentTextOutline,
  models: CubeOutline,
  modelTester: FlaskOutline,
  monitor: PulseOutline,
  events: AlertCircleOutline,
  notifications: NotificationsOutline,
  settings: SettingsOutline,
  oauth: KeypadOutline,
  importExport: CloudUploadOutline,
  about: InformationCircleOutline
};

const navItems = adminRoutes
  .filter((item) => item.meta.nav)
  .map((item) => ({
    key: item.name,
    label: item.meta.title,
    icon: navIcons[item.name]
  }));

const currentPage = computed(() => routeNameFromValue(route.name));
const currentTitle = computed(() => navItems.find((item) => item.key === currentPage.value)?.label || '仪表盘');
const menuOptions = computed<MenuOption[]>(() =>
  navItems.map((item) => ({
    key: item.key,
    label: item.label,
    icon: () => h(NIcon, { size: 18 }, { default: () => h(item.icon) })
  }))
);

function changePage(value: string) {
  const routeName = routeNameFromValue(value);
  if (routeName === currentPage.value) return;
  router.push({ name: routeName });
}

async function checkBackendService() {
  try {
    const response = await fetch('/api/health', { cache: 'no-store' });
    const data = (await response.json()) as { ok?: boolean };
    backendConnected.value = response.ok && data.ok === true;
  } catch {
    backendConnected.value = false;
  }
}

async function copyServiceBaseUrl() {
  try {
    await navigator.clipboard.writeText(serviceBaseUrl.value);
    message.success('服务地址已复制');
  } catch {
    message.error('复制失败，请手动复制');
  }
}

async function loadDisplaySettings() {
  try {
    const snapshot = await api.getSettings();
    setCostDisplayDigits(snapshot.costDisplayDigits);
  } catch {
    // 设置加载失败时保留默认显示位数，不影响管理端基础使用。
  }
}

function logout() {
  session.logout();
  router.push({ name: 'login' });
}

watch(authed, (value) => {
  if (value) void loadDisplaySettings();
});

onMounted(() => {
  void checkBackendService();
  if (authed.value) void loadDisplaySettings();
});
</script>

<template>
  <n-config-provider :theme-overrides="naiveThemeOverrides" :locale="zhCN" :date-locale="dateZhCN">
    <n-dialog-provider>
      <n-message-provider>
        <n-notification-provider>
          <n-loading-bar-provider>
            <div v-if="!booted" class="boot-screen">
              <n-spin size="small" />
              <span>加载中</span>
            </div>
            <RouterView v-else-if="!authed" />
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
                <n-scrollbar class="sider-menu">
                  <n-menu :value="currentPage" :options="menuOptions" :root-indent="18" :indent="12" @update:value="changePage" />
                </n-scrollbar>
                <div class="sider-footer">
                  <n-button block secondary type="error" @click="logout">
                    退出
                  </n-button>
                </div>
              </n-layout-sider>
              <n-layout class="app-main">
                <n-layout-header bordered class="content-header">
                  <div>
                    <h1>{{ currentTitle }}</h1>
                  </div>
                  <div v-if="backendConnected" class="service-status">
                    <n-tag type="success" size="small" round>已连接</n-tag>
                    <button class="service-url" type="button" @click="copyServiceBaseUrl">
                      {{ serviceBaseUrl }}
                    </button>
                  </div>
                </n-layout-header>
                <n-layout-content class="content">
                  <n-scrollbar class="content-scrollbar">
                    <div class="content-body">
                      <RouterView />
                    </div>
                  </n-scrollbar>
                </n-layout-content>
              </n-layout>
            </n-layout>
          </n-loading-bar-provider>
        </n-notification-provider>
      </n-message-provider>
    </n-dialog-provider>
  </n-config-provider>
</template>
