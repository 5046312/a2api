<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue';
import { useDialog, useMessage } from 'naive-ui';
import { api, type Site, type SiteBatchAction, type SiteEndpoint } from '@web/api';

type SiteForm = {
  name: string;
  url: string;
  platform: string;
  status: 'active' | 'disabled';
  globalWeight: number;
  isPinned: boolean;
  sortOrder: number;
  proxyUrl: string;
  useSystemProxy: boolean;
  customHeadersText: string;
};

const sites = ref<Site[]>([]);
const siteEndpoints = ref<SiteEndpoint[]>([]);
const loading = ref(false);
const saving = ref(false);
const endpointLoading = ref(false);
const endpointSaving = ref(false);
const disabledModelsLoading = ref(false);
const disabledModelsSaving = ref(false);
const message = ref('');
const error = ref('');
const editingId = ref<number | null>(null);
const endpointSite = ref<Site | null>(null);
const disabledModelSite = ref<Site | null>(null);
const editingEndpointId = ref<number | null>(null);
const disabledModelsText = ref('');
const availableModels = ref<string[]>([]);
const selectedSiteIds = ref<number[]>([]);
const filters = reactive({ keyword: '', status: '' });
const dialog = useDialog();
const notice = useMessage();
const platformOptions = [
  'openai',
  'new-api',
  'one-api',
  'one-hub',
  'done-hub',
  'veloera',
  'anyrouter',
  'sub2api',
  'cliproxyapi',
  'claude',
  'gemini',
  'codex',
  'gemini-cli',
  'antigravity'
].map((platform) => ({ label: platform, value: platform }));
const siteStatusOptions = [
  { label: '启用', value: 'active' },
  { label: '停用', value: 'disabled' }
];
const filterStatusOptions = [
  { label: '全部状态', value: '' },
  ...siteStatusOptions
];
const form = reactive<SiteForm>({
  name: '',
  url: '',
  platform: 'openai',
  status: 'active',
  globalWeight: 1,
  isPinned: false,
  sortOrder: 0,
  proxyUrl: '',
  useSystemProxy: false,
  customHeadersText: ''
});
const endpointForm = reactive({
  url: '',
  enabled: true,
  sortOrder: 0
});

watch(message, (value) => {
  if (value) notice.success(value);
});

watch(error, (value) => {
  if (value) notice.error(value);
});

function resetForm() {
  editingId.value = null;
  form.name = '';
  form.url = '';
  form.platform = 'openai';
  form.status = 'active';
  form.globalWeight = 1;
  form.isPinned = false;
  form.sortOrder = sites.value.length;
  form.proxyUrl = '';
  form.useSystemProxy = false;
  form.customHeadersText = '';
}

function resetEndpointForm() {
  editingEndpointId.value = null;
  endpointForm.url = '';
  endpointForm.enabled = true;
  endpointForm.sortOrder = siteEndpoints.value.length;
}

function clearEndpointPanel() {
  endpointSite.value = null;
  siteEndpoints.value = [];
  resetEndpointForm();
}

function clearDisabledModelsPanel() {
  disabledModelSite.value = null;
  disabledModelsText.value = '';
  availableModels.value = [];
}

function setError(err: unknown, fallback: string) {
  error.value = err instanceof Error ? err.message : fallback;
}

function formatTime(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : '-';
}

function parseCustomHeaders(): Record<string, string> | null {
  if (!form.customHeadersText.trim()) return null;
  const parsed = JSON.parse(form.customHeadersText) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('自定义 Header 必须是 JSON 对象');
  }
  const headers: Record<string, string> = {};
  Object.entries(parsed as Record<string, unknown>).forEach(([key, value]) => {
    if (typeof value !== 'string') throw new Error('自定义 Header 的值必须是字符串');
    headers[key] = value;
  });
  return headers;
}

function buildPayload() {
  return {
    name: form.name.trim(),
    url: form.url.trim(),
    platform: form.platform.trim(),
    status: form.status,
    globalWeight: Number(form.globalWeight) || 1,
    isPinned: form.isPinned,
    sortOrder: Number(form.sortOrder) || 0,
    proxyUrl: form.proxyUrl.trim() || null,
    useSystemProxy: form.useSystemProxy,
    customHeaders: parseCustomHeaders()
  };
}

function disabledModelRows(): string[] {
  return disabledModelsText.value
    .split('\n')
    .map((model) => model.trim())
    .filter(Boolean);
}

function batchActionLabel(action: SiteBatchAction) {
  const labels: Record<SiteBatchAction, string> = {
    enable: '启用',
    disable: '停用',
    delete: '删除',
    enableSystemProxy: '启用系统代理',
    disableSystemProxy: '停用系统代理'
  };
  return labels[action];
}

function isSiteSelected(id: number) {
  return selectedSiteIds.value.includes(id);
}

function toggleSiteSelection(id: number) {
  selectedSiteIds.value = isSiteSelected(id)
    ? selectedSiteIds.value.filter((item) => item !== id)
    : [...selectedSiteIds.value, id];
}

function allVisibleSitesSelected() {
  return sites.value.length > 0 && sites.value.every((site) => selectedSiteIds.value.includes(site.id));
}

function toggleAllVisibleSites() {
  const visibleIds = sites.value.map((site) => site.id);
  if (!allVisibleSitesSelected()) {
    selectedSiteIds.value = Array.from(new Set([...selectedSiteIds.value, ...visibleIds]));
  } else {
    selectedSiteIds.value = selectedSiteIds.value.filter((id) => !visibleIds.includes(id));
  }
}

async function loadSites() {
  loading.value = true;
  error.value = '';
  try {
    const data = await api.listSites({
      keyword: filters.keyword,
      status: filters.status
    });
    sites.value = data.items;
    selectedSiteIds.value = selectedSiteIds.value.filter((id) => sites.value.some((site) => site.id === id));
    if (endpointSite.value && !sites.value.some((site) => site.id === endpointSite.value?.id)) {
      clearEndpointPanel();
    }
    if (disabledModelSite.value && !sites.value.some((site) => site.id === disabledModelSite.value?.id)) {
      clearDisabledModelsPanel();
    }
  } catch (err) {
    setError(err, '加载内部配置失败');
  } finally {
    loading.value = false;
  }
}

async function loadSiteEndpoints(site: Site) {
  endpointLoading.value = true;
  error.value = '';
  endpointSite.value = site;
  try {
    const data = await api.listSiteEndpoints(site.id);
    siteEndpoints.value = data.items;
    resetEndpointForm();
  } catch (err) {
    setError(err, '加载端点池失败');
  } finally {
    endpointLoading.value = false;
  }
}

async function loadSiteDisabledModels(site: Site) {
  disabledModelsLoading.value = true;
  error.value = '';
  disabledModelSite.value = site;
  availableModels.value = [];
  try {
    const [disabledData, availableData] = await Promise.all([
      api.listSiteDisabledModels(site.id),
      api.listSiteAvailableModels(site.id)
    ]);
    disabledModelsText.value = disabledData.models.join('\n');
    availableModels.value = availableData.models;
  } catch (err) {
    setError(err, '加载模型规则失败');
  } finally {
    disabledModelsLoading.value = false;
  }
}

async function submit() {
  saving.value = true;
  error.value = '';
  message.value = '';
  try {
    const payload = buildPayload();
    if (editingId.value) {
      await api.updateSite(editingId.value, payload);
      message.value = '内部配置已更新';
    } else {
      await api.createSite(payload);
      message.value = '内部配置已创建';
    }
    resetForm();
    await loadSites();
  } catch (err) {
    setError(err, '保存内部配置失败');
  } finally {
    saving.value = false;
  }
}

function editSite(site: Site) {
  editingId.value = site.id;
  form.name = site.name;
  form.url = site.url;
  form.platform = site.platform;
  form.status = site.status === 'disabled' ? 'disabled' : 'active';
  form.globalWeight = site.globalWeight;
  form.isPinned = site.isPinned;
  form.sortOrder = site.sortOrder;
  form.proxyUrl = site.proxyUrl || '';
  form.useSystemProxy = site.useSystemProxy;
  form.customHeadersText = site.customHeaders ? JSON.stringify(site.customHeaders, null, 2) : '';
}

async function detect() {
  if (!form.url.trim()) {
    error.value = '请输入接口地址';
    return;
  }
  saving.value = true;
  error.value = '';
  try {
    const result = await api.detectSite(form.url.trim());
    if (result.platform) form.platform = result.platform;
    message.value = result.message || '检测完成';
  } catch (err) {
    setError(err, '检测内部配置失败');
  } finally {
    saving.value = false;
  }
}

function confirmAction(content: string, onPositiveClick: () => Promise<void>) {
  dialog.warning({
    title: '确认操作',
    content,
    positiveText: '确认',
    negativeText: '取消',
    onPositiveClick
  });
}

function removeSite(site: Site) {
  confirmAction(`删除内部配置 ${site.name}？`, async () => {
    error.value = '';
    try {
      await api.deleteSite(site.id);
      if (endpointSite.value?.id === site.id) clearEndpointPanel();
      if (disabledModelSite.value?.id === site.id) clearDisabledModelsPanel();
      await loadSites();
    } catch (err) {
      setError(err, '删除内部配置失败');
    }
  });
}

async function batchUpdateSites(action: SiteBatchAction) {
  const ids = selectedSiteIds.value.slice();
  if (ids.length === 0) return;
  confirmAction(`批量${batchActionLabel(action)} ${ids.length} 个内部配置？`, async () => {
    loading.value = true;
    error.value = '';
    message.value = '';
    try {
      const result = await api.batchUpdateSites(ids, action);
      selectedSiteIds.value = [];
      message.value = `批量${batchActionLabel(action)}完成：成功 ${result.successIds.length}，失败 ${result.failedItems.length}`;
      await loadSites();
    } catch (err) {
      setError(err, '批量更新内部配置失败');
    } finally {
      loading.value = false;
    }
  });
}

async function saveDisabledModels() {
  const site = disabledModelSite.value;
  if (!site) {
    error.value = '请选择内部配置';
    return;
  }
  disabledModelsSaving.value = true;
  error.value = '';
  message.value = '';
  try {
    const result = await api.updateSiteDisabledModels(site.id, disabledModelRows());
    disabledModelsText.value = result.models.join('\n');
    message.value = result.routeRebuilt ? '禁用模型已保存，模型已重建' : '禁用模型已保存';
  } catch (err) {
    setError(err, '保存禁用模型失败');
  } finally {
    disabledModelsSaving.value = false;
  }
}

function editEndpoint(endpoint: SiteEndpoint) {
  editingEndpointId.value = endpoint.id;
  endpointForm.url = endpoint.url;
  endpointForm.enabled = endpoint.enabled;
  endpointForm.sortOrder = endpoint.sortOrder;
}

async function saveEndpoint() {
  const site = endpointSite.value;
  if (!site) {
    error.value = '请选择内部配置';
    return;
  }
  endpointSaving.value = true;
  error.value = '';
  message.value = '';
  try {
    const payload = {
      url: endpointForm.url.trim(),
      enabled: endpointForm.enabled,
      sortOrder: Number(endpointForm.sortOrder) || 0
    };
    if (editingEndpointId.value) {
      await api.updateSiteEndpoint(editingEndpointId.value, payload);
      message.value = '端点池已更新';
    } else {
      await api.createSiteEndpoint(site.id, payload);
      message.value = '端点池已新增';
    }
    await loadSiteEndpoints(site);
  } catch (err) {
    setError(err, '保存端点池失败');
  } finally {
    endpointSaving.value = false;
  }
}

async function toggleEndpoint(endpoint: SiteEndpoint) {
  const site = endpointSite.value;
  if (!site) return;
  error.value = '';
  try {
    await api.updateSiteEndpoint(endpoint.id, { enabled: !endpoint.enabled });
    await loadSiteEndpoints(site);
  } catch (err) {
    setError(err, '切换端点状态失败');
  }
}

async function removeEndpoint(endpoint: SiteEndpoint) {
  const site = endpointSite.value;
  if (!site) return;
  confirmAction(`删除端点 ${endpoint.url}？`, async () => {
    error.value = '';
    try {
      await api.deleteSiteEndpoint(endpoint.id);
      await loadSiteEndpoints(site);
    } catch (err) {
      setError(err, '删除端点失败');
    }
  });
}

onMounted(loadSites);
</script>

<template>
  <section class="page-stack">
    <n-card class="admin-card" :bordered="false">
      <div class="panel-header">
        <div>
          <h2>内部上游配置</h2>
          <p class="muted">高级调试入口，主流程请使用上游账号。</p>
        </div>
        <n-button secondary attr-type="button" @click="resetForm">清空</n-button>
      </div>
      <form class="form-grid" @submit.prevent="submit">
        <label class="field">
          <span>名称</span>
          <n-input v-model:value="form.name" required />
        </label>
        <label class="field wide">
          <span>接口地址</span>
          <n-input v-model:value="form.url" required placeholder="https://api.example.com" />
        </label>
        <label class="field">
          <span>平台</span>
          <n-select v-model:value="form.platform" filterable :options="platformOptions" />
        </label>
        <label class="field">
          <span>状态</span>
          <n-select v-model:value="form.status" :options="siteStatusOptions" />
        </label>
        <label class="field">
          <span>权重</span>
          <n-input-number v-model:value="form.globalWeight" :min="0.01" :step="0.01" />
        </label>
        <label class="field">
          <span>排序</span>
          <n-input-number v-model:value="form.sortOrder" :min="0" :step="1" />
        </label>
        <label class="field">
          <span>代理</span>
          <n-input v-model:value="form.proxyUrl" placeholder="可选" />
        </label>
        <label class="check-row">
          <n-checkbox v-model:checked="form.isPinned">置顶内部配置</n-checkbox>
        </label>
        <label class="check-row">
          <n-checkbox v-model:checked="form.useSystemProxy">使用系统代理</n-checkbox>
        </label>
        <label class="field wide">
          <span>自定义 Header JSON</span>
          <n-input type="textarea" v-model:value="form.customHeadersText" :rows="4" placeholder='{"x-api-key":"value"}'></n-input>
        </label>
        <div class="form-actions wide">
          <n-button secondary attr-type="button" :disabled="saving" @click="detect">检测平台</n-button>
          <n-button type="primary" attr-type="submit" :disabled="saving">
            {{ saving ? '保存中' : editingId ? '更新内部配置' : '创建内部配置' }}
          </n-button>
        </div>
      </form>
    </n-card>

    <n-card class="admin-card" :bordered="false">
      <div class="toolbar">
        <n-input v-model:value="filters.keyword" placeholder="搜索名称或接口地址" @keyup.enter="loadSites" />
        <n-select v-model:value="filters.status" :options="filterStatusOptions" class="toolbar-select" @update:value="loadSites" />
        <n-button secondary attr-type="button" @click="loadSites">刷新</n-button>
        <n-button secondary attr-type="button" :disabled="selectedSiteIds.length === 0 || loading" @click="batchUpdateSites('enable')">批量启用</n-button>
        <n-button secondary attr-type="button" :disabled="selectedSiteIds.length === 0 || loading" @click="batchUpdateSites('disable')">批量停用</n-button>
        <n-button secondary attr-type="button" :disabled="selectedSiteIds.length === 0 || loading" @click="batchUpdateSites('enableSystemProxy')">批量系统代理</n-button>
        <n-button secondary attr-type="button" :disabled="selectedSiteIds.length === 0 || loading" @click="batchUpdateSites('disableSystemProxy')">取消系统代理</n-button>
        <n-button secondary attr-type="button" :disabled="selectedSiteIds.length === 0 || loading" @click="batchUpdateSites('delete')">批量删除</n-button>
        <span class="muted">已选 {{ selectedSiteIds.length }}</span>
      </div>
      <div class="table-wrap">
        <n-table size="small" :bordered="false" single-line class="admin-table">
          <thead>
            <tr>
              <th>
                <n-checkbox :checked="allVisibleSitesSelected()" :disabled="sites.length === 0" @update:checked="toggleAllVisibleSites" />
              </th>
              <th>名称</th>
              <th>平台</th>
              <th>接口地址</th>
              <th>状态</th>
              <th>权重</th>
              <th>排序</th>
              <th>置顶</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="site in sites" :key="site.id" :class="{ selected: isSiteSelected(site.id) }">
              <td>
                <n-checkbox :checked="isSiteSelected(site.id)" @update:checked="toggleSiteSelection(site.id)" />
              </td>
              <td>{{ site.name }}</td>
              <td>{{ site.platform }}</td>
              <td class="mono">{{ site.url }}</td>
              <td>
                <n-tag size="small" :type="site.status === 'active' ? 'success' : 'error'">{{ site.status }}</n-tag>
              </td>
              <td>{{ site.globalWeight }}</td>
              <td>{{ site.sortOrder }}</td>
              <td>{{ site.isPinned ? '是' : '否' }}</td>
              <td class="actions">
                <n-button text attr-type="button" @click="loadSiteEndpoints(site)">端点池</n-button>
                <n-button text attr-type="button" @click="loadSiteDisabledModels(site)">禁用模型</n-button>
                <n-button text attr-type="button" @click="editSite(site)">编辑</n-button>
                <n-button type="error" text attr-type="button" @click="removeSite(site)">删除</n-button>
              </td>
            </tr>
            <tr v-if="!loading && sites.length === 0">
              <td class="empty" colspan="9">暂无内部配置</td>
            </tr>
          </tbody>
        </n-table>
      </div>
    </n-card>

    <n-card class="admin-card" :bordered="false" v-if="disabledModelSite">
      <div class="panel-header">
        <div>
          <h2>禁用模型：{{ disabledModelSite.name }}</h2>
          <p class="muted">{{ disabledModelRows().length }} 条规则 / {{ availableModels.length }} 个可用模型</p>
        </div>
        <n-button secondary attr-type="button" @click="clearDisabledModelsPanel">关闭</n-button>
      </div>

      <div v-if="availableModels.length > 0" class="model-list">
        <span v-for="model in availableModels" :key="model" class="chip">{{ model }}</span>
      </div>

      <form class="form-grid" @submit.prevent="saveDisabledModels">
        <label class="field wide">
          <span>模型规则</span>
          <n-input type="textarea" v-model:value="disabledModelsText" :rows="6" :disabled="disabledModelsLoading" placeholder="gpt-4o&#10;gpt-*"></n-input>
        </label>
        <div class="form-actions wide">
          <n-button type="primary" attr-type="submit" :disabled="disabledModelsSaving || disabledModelsLoading">
            {{ disabledModelsSaving ? '保存中' : '保存禁用模型' }}
          </n-button>
        </div>
      </form>
    </n-card>

    <n-card class="admin-card" :bordered="false" v-if="endpointSite">
      <div class="panel-header">
        <div>
          <h2>端点池：{{ endpointSite.name }}</h2>
          <p class="muted">{{ siteEndpoints.length }} 个端点</p>
        </div>
        <n-button secondary attr-type="button" @click="clearEndpointPanel">关闭</n-button>
      </div>

      <form class="form-grid" @submit.prevent="saveEndpoint">
        <label class="field wide">
          <span>端点地址</span>
          <n-input v-model:value="endpointForm.url" required placeholder="https://api.example.com" />
        </label>
        <label class="field">
          <span>排序</span>
          <n-input-number v-model:value="endpointForm.sortOrder" :min="0" :step="1" />
        </label>
        <label class="check-row">
          <n-checkbox v-model:checked="endpointForm.enabled">启用端点</n-checkbox>
        </label>
        <div class="form-actions wide">
          <n-button secondary attr-type="button" :disabled="endpointSaving" @click="resetEndpointForm">清空端点</n-button>
          <n-button type="primary" attr-type="submit" :disabled="endpointSaving">
            {{ endpointSaving ? '保存中' : editingEndpointId ? '更新端点' : '新增端点' }}
          </n-button>
        </div>
      </form>

      <div class="table-wrap">
        <n-table size="small" :bordered="false" single-line class="admin-table">
          <thead>
            <tr>
              <th>端点地址</th>
              <th>状态</th>
              <th>排序</th>
              <th>冷却到</th>
              <th>最近失败</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="endpoint in siteEndpoints" :key="endpoint.id">
              <td class="mono">{{ endpoint.url }}</td>
              <td>
                <n-tag size="small" :type="endpoint.enabled ? 'success' : 'error'">
                  {{ endpoint.enabled ? '启用' : '停用' }}
                </n-tag>
              </td>
              <td>{{ endpoint.sortOrder }}</td>
              <td>{{ formatTime(endpoint.cooldownUntil) }}</td>
              <td>{{ endpoint.lastFailureReason || '-' }}</td>
              <td class="actions">
                <n-button text attr-type="button" @click="editEndpoint(endpoint)">编辑</n-button>
                <n-button text attr-type="button" @click="toggleEndpoint(endpoint)">
                  {{ endpoint.enabled ? '停用' : '启用' }}
                </n-button>
                <n-button type="error" text attr-type="button" @click="removeEndpoint(endpoint)">删除</n-button>
              </td>
            </tr>
            <tr v-if="!endpointLoading && siteEndpoints.length === 0">
              <td class="empty" colspan="6">暂无端点</td>
            </tr>
          </tbody>
        </n-table>
      </div>
    </n-card>
  </section>
</template>
