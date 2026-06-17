<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useDialog } from 'naive-ui';
import {
  api,
  type BackupImportResult,
  type BackupType,
  type BackupWebdavSnapshot,
  type BackupWebdavState,
  type ClientConfigItem
} from '@web/api';

const exportType = ref<BackupType>('all');
const importType = ref<BackupType>('all');
const importDocument = ref<unknown | null>(null);
const importFileName = ref('');
const loading = ref(false);
const error = ref('');
const message = ref('');
const importResult = ref<BackupImportResult | null>(null);
const dialog = useDialog();
const webdavLoading = ref(false);
const webdavPasswordMasked = ref('');
const webdavState = ref<BackupWebdavState>({ lastSyncAt: null, lastError: null });
const clientConfigLoading = ref(false);
const clientConfigs = ref<ClientConfigItem[]>([]);
const clientConfigForm = ref({
  baseUrl: window.location.origin,
  model: '',
  apiKey: ''
});
const webdavForm = ref({
  enabled: false,
  fileUrl: '',
  username: '',
  password: '',
  clearPassword: false,
  exportType: 'all' as BackupType,
  autoSyncEnabled: false,
  autoSyncCron: '0 */6 * * *'
});
const backupTypeOptions = [
  { label: '全部', value: 'all' },
  { label: '账号数据', value: 'accounts' },
  { label: '偏好设置', value: 'preferences' }
];

const summaryRows = computed(() => {
  const summary = importResult.value?.summary;
  if (!summary) return [];
  return [
    { label: '新增', value: summary.created },
    { label: '更新', value: summary.updated },
    { label: '跳过', value: summary.skipped },
    { label: '上游', value: summary.importedSites },
    { label: '账号', value: summary.importedAccounts },
    { label: '凭据', value: summary.importedTokens },
    { label: '路由', value: summary.importedRoutes },
    { label: '下游 Key', value: summary.importedDownstreamKeys },
    { label: '文件', value: summary.importedProxyFiles },
    { label: '视频任务', value: summary.importedProxyVideoTasks },
    { label: '偏好', value: summary.importedPreferences }
  ];
});

function setError(err: unknown, fallback: string) {
  error.value = err instanceof Error ? err.message : fallback;
}

function backupFileName(type: BackupType) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `a2api-${type}-${timestamp}.json`;
}

async function exportJson() {
  loading.value = true;
  error.value = '';
  message.value = '';
  try {
    const documentData = await api.exportBackup(exportType.value);
    const blob = new Blob([JSON.stringify(documentData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = backupFileName(exportType.value);
    link.click();
    URL.revokeObjectURL(url);
    message.value = '导出已生成';
  } catch (err) {
    setError(err, '导出失败');
  } finally {
    loading.value = false;
  }
}

async function selectImportFile(event: Event) {
  error.value = '';
  message.value = '';
  importResult.value = null;
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  importFileName.value = file.name;
  try {
    importDocument.value = JSON.parse(await file.text());
  } catch {
    importDocument.value = null;
    error.value = 'JSON 文件格式无效';
  }
}

async function importJson() {
  if (!importDocument.value) return;
  dialog.warning({
    title: '确认导入',
    content: `导入 ${importType.value} 备份？`,
    positiveText: '确认导入',
    negativeText: '取消',
    onPositiveClick: async () => {
      loading.value = true;
      error.value = '';
      message.value = '';
      try {
        importResult.value = await api.importBackup(importDocument.value, importType.value);
        message.value = '导入完成';
      } catch (err) {
        setError(err, '导入失败');
      } finally {
        loading.value = false;
      }
    }
  });
}

function applyWebdavSnapshot(snapshot: BackupWebdavSnapshot) {
  webdavForm.value = {
    enabled: snapshot.config.enabled,
    fileUrl: snapshot.config.fileUrl,
    username: snapshot.config.username,
    password: '',
    clearPassword: false,
    exportType: snapshot.config.exportType,
    autoSyncEnabled: snapshot.config.autoSyncEnabled,
    autoSyncCron: snapshot.config.autoSyncCron
  };
  webdavPasswordMasked.value = snapshot.config.passwordMasked;
  webdavState.value = snapshot.state;
}

async function loadWebdavConfig() {
  webdavLoading.value = true;
  error.value = '';
  try {
    applyWebdavSnapshot(await api.getBackupWebdavConfig());
  } catch (err) {
    setError(err, '加载 WebDAV 配置失败');
  } finally {
    webdavLoading.value = false;
  }
}

async function saveWebdavConfig() {
  webdavLoading.value = true;
  error.value = '';
  message.value = '';
  const body: Record<string, unknown> = {
    enabled: webdavForm.value.enabled,
    fileUrl: webdavForm.value.fileUrl,
    username: webdavForm.value.username,
    exportType: webdavForm.value.exportType,
    autoSyncEnabled: webdavForm.value.autoSyncEnabled,
    autoSyncCron: webdavForm.value.autoSyncCron,
    clearPassword: webdavForm.value.clearPassword
  };
  if (webdavForm.value.password) body.password = webdavForm.value.password;
  try {
    applyWebdavSnapshot(await api.updateBackupWebdavConfig(body));
    message.value = 'WebDAV 配置已保存';
  } catch (err) {
    setError(err, '保存 WebDAV 配置失败');
  } finally {
    webdavLoading.value = false;
  }
}

async function exportWebdav() {
  webdavLoading.value = true;
  error.value = '';
  message.value = '';
  try {
    const result = await api.exportBackupToWebdav(webdavForm.value.exportType);
    webdavState.value = { lastSyncAt: result.lastSyncAt, lastError: result.lastError };
    message.value = `WebDAV 导出完成：${result.fileUrl}`;
  } catch (err) {
    setError(err, 'WebDAV 导出失败');
  } finally {
    webdavLoading.value = false;
  }
}

async function importWebdav() {
  dialog.warning({
    title: '确认导入',
    content: '从 WebDAV 导入备份？',
    positiveText: '确认导入',
    negativeText: '取消',
    onPositiveClick: async () => {
      webdavLoading.value = true;
      error.value = '';
      message.value = '';
      importResult.value = null;
      try {
        const result = await api.importBackupFromWebdav();
        importResult.value = result;
        webdavState.value = { lastSyncAt: result.lastSyncAt, lastError: result.lastError };
        message.value = `WebDAV 导入完成：${result.fileUrl}`;
      } catch (err) {
        setError(err, 'WebDAV 导入失败');
      } finally {
        webdavLoading.value = false;
      }
    }
  });
}

function renderClientConfig(content: string) {
  const apiKey = clientConfigForm.value.apiKey.trim();
  return apiKey ? content.replaceAll('<your-proxy-key>', apiKey) : content;
}

function renderClientFieldValue(value: string) {
  return renderClientConfig(value);
}

async function loadClientConfigs() {
  clientConfigLoading.value = true;
  error.value = '';
  try {
    const snapshot = await api.getClientConfigs({
      baseUrl: clientConfigForm.value.baseUrl.trim(),
      model: clientConfigForm.value.model.trim()
    });
    clientConfigForm.value.baseUrl = snapshot.baseUrl;
    if (!clientConfigForm.value.model.trim()) clientConfigForm.value.model = snapshot.model;
    clientConfigs.value = snapshot.items;
  } catch (err) {
    setError(err, '生成外部工具配置失败');
  } finally {
    clientConfigLoading.value = false;
  }
}

async function copyClientConfig(content: string) {
  try {
    await navigator.clipboard.writeText(renderClientConfig(content));
    message.value = '配置已复制';
  } catch {
    error.value = '复制失败，请手动选择内容';
  }
}

onMounted(() => {
  void loadWebdavConfig();
  void loadClientConfigs();
});
</script>

<template>
  <section class="page-stack">
    <div class="two-column">
      <n-card class="admin-card" :bordered="false">
        <div class="panel-header">
          <div>
            <h2>JSON 导出</h2>
            <p class="muted">生成 a2api v1 备份文件。</p>
          </div>
        </div>
        <div class="form-grid single">
          <label class="field">
            <span>范围</span>
            <n-select v-model:value="exportType" :options="backupTypeOptions" />
          </label>
          <div class="form-actions">
            <n-button type="primary" attr-type="button" :disabled="loading" @click="exportJson">
              {{ loading ? '处理中' : '下载 JSON' }}
            </n-button>
          </div>
        </div>
      </n-card>

      <n-card class="admin-card" :bordered="false">
        <div class="panel-header">
          <div>
            <h2>JSON 导入</h2>
            <p class="muted">导入会按稳定键合并现有数据。</p>
          </div>
        </div>
        <div class="form-grid single">
          <label class="field">
            <span>范围</span>
            <n-select v-model:value="importType" :options="backupTypeOptions" />
          </label>
          <label class="field">
            <span>文件</span>
            <input class="native-input" type="file" accept="application/json,.json" @change="selectImportFile" />
          </label>
          <p v-if="importFileName" class="muted mono">{{ importFileName }}</p>
          <div class="form-actions">
            <n-button type="primary" attr-type="button" :disabled="loading || !importDocument" @click="importJson">
              {{ loading ? '处理中' : '导入 JSON' }}
            </n-button>
          </div>
        </div>
      </n-card>
    </div>

    <n-card class="admin-card" :bordered="false">
      <div class="panel-header">
        <div>
          <h2>WebDAV 备份</h2>
          <p class="muted">使用远端 JSON 文件做手动同步，自动同步只执行导出。</p>
        </div>
      </div>
      <form class="form-grid" @submit.prevent="saveWebdavConfig">
        <label class="check-row">
          <n-checkbox v-model:checked="webdavForm.enabled">启用 WebDAV</n-checkbox>
        </label>
        <label class="check-row">
          <n-checkbox v-model:checked="webdavForm.autoSyncEnabled">自动导出</n-checkbox>
        </label>
        <label class="field">
          <span>自动导出 Cron</span>
          <n-input v-model:value="webdavForm.autoSyncCron" placeholder="0 */6 * * *" />
        </label>
        <label class="field wide">
          <span>文件 URL</span>
          <n-input v-model:value="webdavForm.fileUrl" placeholder="https://example.com/dav/a2api-backup.json" />
        </label>
        <label class="field">
          <span>用户名</span>
          <n-input v-model:value="webdavForm.username" autocomplete="username" />
        </label>
        <label class="field">
          <span>密码</span>
          <n-input v-model:value="webdavForm.password" type="password" autocomplete="current-password" placeholder="留空则保留" />
          <span class="muted">当前：{{ webdavPasswordMasked || '未设置' }}</span>
        </label>
        <label class="field">
          <span>默认范围</span>
          <n-select v-model:value="webdavForm.exportType" :options="backupTypeOptions" />
        </label>
        <label class="check-row">
          <n-checkbox v-model:checked="webdavForm.clearPassword">清空密码</n-checkbox>
        </label>
        <div class="form-actions wide">
          <n-button type="primary" attr-type="submit" :disabled="webdavLoading">
            {{ webdavLoading ? '处理中' : '保存 WebDAV' }}
          </n-button>
          <n-button secondary attr-type="button" :disabled="webdavLoading" @click="loadWebdavConfig">刷新</n-button>
          <n-button secondary attr-type="button" :disabled="webdavLoading" @click="exportWebdav">导出到 WebDAV</n-button>
          <n-button secondary attr-type="button" :disabled="webdavLoading" @click="importWebdav">从 WebDAV 导入</n-button>
        </div>
      </form>
      <p class="muted">上次同步：{{ webdavState.lastSyncAt || '-' }}</p>
      <n-alert v-if="webdavState.lastError" type="error" :bordered="false">WebDAV 错误：{{ webdavState.lastError }}</n-alert>
    </n-card>

    <n-card class="admin-card" :bordered="false">
      <div class="panel-header">
        <div>
          <h2>外部工具配置</h2>
          <p class="muted">生成客户端接入片段，密钥只在浏览器本地替换。</p>
        </div>
        <n-button secondary attr-type="button" :disabled="clientConfigLoading" @click="loadClientConfigs">
          {{ clientConfigLoading ? '生成中' : '重新生成' }}
        </n-button>
      </div>
      <div class="form-grid">
        <label class="field">
          <span>服务地址</span>
          <n-input v-model:value="clientConfigForm.baseUrl" placeholder="https://your-domain.com" />
        </label>
        <label class="field">
          <span>默认模型</span>
          <n-input v-model:value="clientConfigForm.model" placeholder="从 /v1/models 选择" />
        </label>
        <label class="field">
          <span>API Key</span>
          <n-input v-model:value="clientConfigForm.apiKey" type="password" placeholder="留空使用占位符" />
        </label>
      </div>
      <div class="client-config-list">
        <div v-for="item in clientConfigs" :key="item.id" class="client-config-item">
          <div class="client-config-header">
            <div>
              <h3>{{ item.name }}</h3>
              <p class="muted">{{ item.description }}</p>
            </div>
          </div>
          <div class="client-config-fields">
            <span v-for="field in item.fields" :key="`${item.id}-${field.label}`">
              {{ field.label }}：<strong>{{ renderClientFieldValue(field.value) }}</strong>
            </span>
          </div>
          <div v-for="file in item.files" :key="`${item.id}-${file.filename}`" class="client-config-file">
            <div class="client-config-file-title">
              <span>{{ file.filename }}</span>
              <n-button secondary attr-type="button" @click="copyClientConfig(file.content)">复制</n-button>
            </div>
            <pre>{{ renderClientConfig(file.content) }}</pre>
          </div>
        </div>
      </div>
    </n-card>

    <n-alert v-if="message" type="success" :bordered="false">{{ message }}</n-alert>
    <n-alert v-if="error" type="error" :bordered="false">{{ error }}</n-alert>

    <n-card class="admin-card" :bordered="false" v-if="importResult">
      <div class="panel-header">
        <h2>导入结果</h2>
      </div>
      <div class="stats-grid">
        <div v-for="row in summaryRows" :key="row.label" class="stat-card">
          <span class="stat-label">{{ row.label }}</span>
          <strong class="stat-value">{{ row.value }}</strong>
        </div>
      </div>
      <div v-if="importResult.warnings.length > 0" class="table-wrap">
        <n-table size="small" :bordered="false" single-line class="admin-table">
          <thead>
            <tr>
              <th>警告</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in importResult.warnings" :key="item">
              <td>{{ item }}</td>
            </tr>
          </tbody>
        </n-table>
      </div>
    </n-card>
  </section>
</template>

<style scoped lang="scss">
.client-config-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-top: 16px;
}

.client-config-item {
  display: flex;
  flex-direction: column;
  gap: 10px;
  border: 1px solid #d6dde8;
  border-radius: 8px;
  background: #f8fafc;
  padding: 14px;
}

.client-config-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.client-config-header h3 {
  margin: 0;
  color: #172033;
  font-size: 16px;
}

.client-config-fields {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  color: #4d5d73;
  font-size: 13px;
}

.client-config-fields span {
  border: 1px solid #d6dde8;
  border-radius: 999px;
  background: #ffffff;
  padding: 5px 9px;
}

.client-config-file {
  border: 1px solid #d6dde8;
  border-radius: 8px;
  background: #ffffff;
  overflow: hidden;
}

.client-config-file-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border-bottom: 1px solid #d6dde8;
  padding: 8px 10px;
  color: #26364b;
  font-size: 13px;
  font-weight: 700;
}

.client-config-file pre {
  max-height: 260px;
  overflow: auto;
  margin: 0;
  background: #0f172a;
  color: #e2e8f0;
  padding: 12px;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
