import compact from 'lodash/compact';
import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
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
import ProxyLogsPage from '@pages/ProxyLogsPage.vue';
import RoutesPage from '@pages/RoutesPage.vue';
import SettingsPage from '@pages/SettingsPage.vue';
import { useAdminSessionStore } from '@web/stores/adminSession';

export const adminRouteNames = {
  dashboard: 'dashboard',
  accounts: 'accounts',
  routes: 'routes',
  downstreamKeys: 'downstreamKeys',
  proxyLogs: 'proxyLogs',
  models: 'models',
  modelTester: 'modelTester',
  monitor: 'monitor',
  events: 'events',
  notifications: 'notifications',
  settings: 'settings',
  oauth: 'oauth',
  importExport: 'importExport',
  about: 'about'
} as const;

export type AdminRouteName = (typeof adminRouteNames)[keyof typeof adminRouteNames];

type AdminRouteMeta = {
  title: string;
  nav: boolean;
};

export type AdminRouteRecord = RouteRecordRaw & {
  name: AdminRouteName;
  meta: AdminRouteMeta;
};

export const adminRoutes: AdminRouteRecord[] = [
  { path: '/', name: adminRouteNames.dashboard, component: DashboardPage, meta: { title: '仪表盘', nav: true } },
  { path: '/accounts', name: adminRouteNames.accounts, component: AccountsPage, meta: { title: '上游账号', nav: true } },
  { path: '/routes', name: adminRouteNames.routes, component: RoutesPage, meta: { title: '模型', nav: true } },
  {
    path: '/downstream-keys',
    name: adminRouteNames.downstreamKeys,
    component: DownstreamKeysPage,
    meta: { title: '密钥', nav: true }
  },
  {
    path: '/proxy-logs',
    name: adminRouteNames.proxyLogs,
    component: ProxyLogsPage,
    meta: { title: '日志', nav: true }
  },
  { path: '/models', name: adminRouteNames.models, component: ModelsPage, meta: { title: '广场', nav: true } },
  {
    path: '/model-tester',
    name: adminRouteNames.modelTester,
    component: ModelTesterPage,
    meta: { title: '操练场', nav: true }
  },
  { path: '/monitors', name: adminRouteNames.monitor, component: MonitorPage, meta: { title: '监控', nav: true } },
  { path: '/events', name: adminRouteNames.events, component: EventsPage, meta: { title: '事件', nav: true } },
  {
    path: '/notifications',
    name: adminRouteNames.notifications,
    component: NotificationsPage,
    meta: { title: '通知', nav: true }
  },
  { path: '/settings', name: adminRouteNames.settings, component: SettingsPage, meta: { title: '设置', nav: true } },
  { path: '/oauth', name: adminRouteNames.oauth, component: OAuthPage, meta: { title: 'OAuth', nav: true } },
  {
    path: '/import-export',
    name: adminRouteNames.importExport,
    component: ImportExportPage,
    meta: { title: '导入导出', nav: true }
  },
  { path: '/about', name: adminRouteNames.about, component: AboutPage, meta: { title: '关于', nav: true } }
];

const routes: RouteRecordRaw[] = [
  { path: '/login', name: 'login', component: LoginPage, meta: { public: true } },
  ...adminRoutes,
  { path: '/:pathMatch(.*)*', redirect: '/' }
];

export const router = createRouter({
  history: createWebHistory(),
  routes
});

router.beforeEach(async (to) => {
  const session = useAdminSessionStore();
  if (!session.booted) {
    // 首次进入时校验一次服务端 Token，避免只凭本地存储放行。
    await session.bootstrap();
  }

  if (!to.meta.public && !session.authed) {
    return { name: 'login' };
  }

  if (to.name === 'login' && session.authed) {
    return { name: adminRouteNames.dashboard };
  }

  return true;
});

export function routeNameFromValue(value: unknown): AdminRouteName {
  const [firstRoute] = compact(adminRoutes.map((route) => (route.name === value ? route.name : null)));
  return firstRoute || adminRouteNames.dashboard;
}
