<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
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

function toggleAllVisibleSites(event: Event) {
  const checked = (event.target as HTMLInputElement).checked;
  const visibleIds = sites.value.map((site) => site.id);
  if (checked) {
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
    setError(err, '加载站点失败');
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
    setError(err, '加载地址池失败');
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
      message.value = '站点已更新';
    } else {
      await api.createSite(payload);
      message.value = '站点已创建';
    }
    resetForm();
    await loadSites();
  } catch (err) {
    setError(err, '保存站点失败');
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
    error.value = '请输入站点地址';
    return;
  }
  saving.value = true;
  error.value = '';
  try {
    const result = await api.detectSite(form.url.trim());
    if (result.platform) form.platform = result.platform;
    message.value = result.message || '检测完成';
  } catch (err) {
    setError(err, '检测站点失败');
  } finally {
    saving.value = false;
  }
}

async function removeSite(site: Site) {
  if (!window.confirm(`删除站点 ${site.name}？`)) return;
  error.value = '';
  try {
    await api.deleteSite(site.id);
    if (endpointSite.value?.id === site.id) clearEndpointPanel();
    if (disabledModelSite.value?.id === site.id) clearDisabledModelsPanel();
    await loadSites();
  } catch (err) {
    setError(err, '删除站点失败');
  }
}

async function batchUpdateSites(action: SiteBatchAction) {
  const ids = selectedSiteIds.value.slice();
  if (ids.length === 0) return;
  if (!window.confirm(`批量${batchActionLabel(action)} ${ids.length} 个站点？`)) return;
  loading.value = true;
  error.value = '';
  message.value = '';
  try {
    const result = await api.batchUpdateSites(ids, action);
    selectedSiteIds.value = [];
    message.value = `批量${batchActionLabel(action)}完成：成功 ${result.successIds.length}，失败 ${result.failedItems.length}`;
    await loadSites();
  } catch (err) {
    setError(err, '批量更新站点失败');
  } finally {
    loading.value = false;
  }
}

async function saveDisabledModels() {
  const site = disabledModelSite.value;
  if (!site) {
    error.value = '请选择站点';
    return;
  }
  disabledModelsSaving.value = true;
  error.value = '';
  message.value = '';
  try {
    const result = await api.updateSiteDisabledModels(site.id, disabledModelRows());
    disabledModelsText.value = result.models.join('\n');
    message.value = result.routeRebuilt ? '禁用模型已保存，路由已重建' : '禁用模型已保存';
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
    error.value = '请选择站点';
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
      message.value = '地址池已更新';
    } else {
      await api.createSiteEndpoint(site.id, payload);
      message.value = '地址池已新增';
    }
    await loadSiteEndpoints(site);
  } catch (err) {
    setError(err, '保存地址池失败');
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
    setError(err, '切换地址状态失败');
  }
}

async function removeEndpoint(endpoint: SiteEndpoint) {
  const site = endpointSite.value;
  if (!site || !window.confirm(`删除地址 ${endpoint.url}？`)) return;
  error.value = '';
  try {
    await api.deleteSiteEndpoint(endpoint.id);
    await loadSiteEndpoints(site);
  } catch (err) {
    setError(err, '删除地址失败');
  }
}

onMounted(loadSites);
</script>

<template>
  <section class="page-stack">
    <div class="panel">
      <div class="panel-header">
        <div>
          <h2>站点配置</h2>
          <p class="muted">管理上游 API 站点和代理参数。</p>
        </div>
        <button class="btn btn-secondary" type="button" @click="resetForm">清空</button>
      </div>
      <form class="form-grid" @submit.prevent="submit">
        <label class="field">
          <span>名称</span>
          <input v-model="form.name" class="input" required />
        </label>
        <label class="field wide">
          <span>地址</span>
          <input v-model="form.url" class="input" required placeholder="https://api.example.com" />
        </label>
        <label class="field">
          <span>平台</span>
          <input v-model="form.platform" class="input" required />
        </label>
        <label class="field">
          <span>状态</span>
          <select v-model="form.status" class="select">
            <option value="active">启用</option>
            <option value="disabled">停用</option>
          </select>
        </label>
        <label class="field">
          <span>权重</span>
          <input v-model.number="form.globalWeight" class="input" min="0.01" step="0.01" type="number" />
        </label>
        <label class="field">
          <span>排序</span>
          <input v-model.number="form.sortOrder" class="input" min="0" step="1" type="number" />
        </label>
        <label class="field">
          <span>代理地址</span>
          <input v-model="form.proxyUrl" class="input" placeholder="可选" />
        </label>
        <label class="check-row">
          <input v-model="form.isPinned" type="checkbox" />
          <span>置顶站点</span>
        </label>
        <label class="check-row">
          <input v-model="form.useSystemProxy" type="checkbox" />
          <span>使用系统代理</span>
        </label>
        <label class="field wide">
          <span>自定义 Header JSON</span>
          <textarea v-model="form.customHeadersText" class="textarea" rows="4" placeholder='{"x-api-key":"value"}'></textarea>
        </label>
        <div class="form-actions wide">
          <button class="btn btn-secondary" type="button" :disabled="saving" @click="detect">检测平台</button>
          <button class="btn btn-primary" type="submit" :disabled="saving">
            {{ saving ? '保存中' : editingId ? '更新站点' : '创建站点' }}
          </button>
        </div>
      </form>
      <p v-if="message" class="notice">{{ message }}</p>
      <p v-if="error" class="error">{{ error }}</p>
    </div>

    <div class="panel">
      <div class="toolbar">
        <input v-model="filters.keyword" class="input" placeholder="搜索名称或地址" @keyup.enter="loadSites" />
        <select v-model="filters.status" class="select" @change="loadSites">
          <option value="">全部状态</option>
          <option value="active">启用</option>
          <option value="disabled">停用</option>
        </select>
        <button class="btn btn-secondary" type="button" @click="loadSites">刷新</button>
        <button class="btn btn-secondary" type="button" :disabled="selectedSiteIds.length === 0 || loading" @click="batchUpdateSites('enable')">批量启用</button>
        <button class="btn btn-secondary" type="button" :disabled="selectedSiteIds.length === 0 || loading" @click="batchUpdateSites('disable')">批量停用</button>
        <button class="btn btn-secondary" type="button" :disabled="selectedSiteIds.length === 0 || loading" @click="batchUpdateSites('enableSystemProxy')">批量系统代理</button>
        <button class="btn btn-secondary" type="button" :disabled="selectedSiteIds.length === 0 || loading" @click="batchUpdateSites('disableSystemProxy')">取消系统代理</button>
        <button class="btn btn-secondary" type="button" :disabled="selectedSiteIds.length === 0 || loading" @click="batchUpdateSites('delete')">批量删除</button>
        <span class="muted">已选 {{ selectedSiteIds.length }}</span>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>
                <input type="checkbox" :checked="allVisibleSitesSelected()" :disabled="sites.length === 0" @change="toggleAllVisibleSites" />
              </th>
              <th>名称</th>
              <th>平台</th>
              <th>地址</th>
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
                <input type="checkbox" :checked="isSiteSelected(site.id)" @change="toggleSiteSelection(site.id)" />
              </td>
              <td>{{ site.name }}</td>
              <td>{{ site.platform }}</td>
              <td class="mono">{{ site.url }}</td>
              <td><span class="badge" :class="site.status">{{ site.status }}</span></td>
              <td>{{ site.globalWeight }}</td>
              <td>{{ site.sortOrder }}</td>
              <td>{{ site.isPinned ? '是' : '否' }}</td>
              <td class="actions">
                <button class="text-btn" type="button" @click="loadSiteEndpoints(site)">地址池</button>
                <button class="text-btn" type="button" @click="loadSiteDisabledModels(site)">禁用模型</button>
                <button class="text-btn" type="button" @click="editSite(site)">编辑</button>
                <button class="text-btn danger" type="button" @click="removeSite(site)">删除</button>
              </td>
            </tr>
            <tr v-if="!loading && sites.length === 0">
              <td class="empty" colspan="9">暂无站点</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div v-if="disabledModelSite" class="panel">
      <div class="panel-header">
        <div>
          <h2>禁用模型：{{ disabledModelSite.name }}</h2>
          <p class="muted">{{ disabledModelRows().length }} 条规则 / {{ availableModels.length }} 个可用模型</p>
        </div>
        <button class="btn btn-secondary" type="button" @click="clearDisabledModelsPanel">关闭</button>
      </div>

      <div v-if="availableModels.length > 0" class="model-list">
        <span v-for="model in availableModels" :key="model" class="chip">{{ model }}</span>
      </div>

      <form class="form-grid" @submit.prevent="saveDisabledModels">
        <label class="field wide">
          <span>模型规则</span>
          <textarea v-model="disabledModelsText" class="textarea" rows="6" :disabled="disabledModelsLoading" placeholder="gpt-4o&#10;gpt-*"></textarea>
        </label>
        <div class="form-actions wide">
          <button class="btn btn-primary" type="submit" :disabled="disabledModelsSaving || disabledModelsLoading">
            {{ disabledModelsSaving ? '保存中' : '保存禁用模型' }}
          </button>
        </div>
      </form>
    </div>

    <div v-if="endpointSite" class="panel">
      <div class="panel-header">
        <div>
          <h2>地址池：{{ endpointSite.name }}</h2>
          <p class="muted">{{ siteEndpoints.length }} 个地址</p>
        </div>
        <button class="btn btn-secondary" type="button" @click="clearEndpointPanel">关闭</button>
      </div>

      <form class="form-grid" @submit.prevent="saveEndpoint">
        <label class="field wide">
          <span>API 地址</span>
          <input v-model="endpointForm.url" class="input" required placeholder="https://api.example.com" />
        </label>
        <label class="field">
          <span>排序</span>
          <input v-model.number="endpointForm.sortOrder" class="input" min="0" step="1" type="number" />
        </label>
        <label class="check-row">
          <input v-model="endpointForm.enabled" type="checkbox" />
          <span>启用地址</span>
        </label>
        <div class="form-actions wide">
          <button class="btn btn-secondary" type="button" :disabled="endpointSaving" @click="resetEndpointForm">清空地址</button>
          <button class="btn btn-primary" type="submit" :disabled="endpointSaving">
            {{ endpointSaving ? '保存中' : editingEndpointId ? '更新地址' : '新增地址' }}
          </button>
        </div>
      </form>

      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>地址</th>
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
              <td><span class="badge" :class="endpoint.enabled ? 'active' : 'disabled'">{{ endpoint.enabled ? '启用' : '停用' }}</span></td>
              <td>{{ endpoint.sortOrder }}</td>
              <td>{{ formatTime(endpoint.cooldownUntil) }}</td>
              <td>{{ endpoint.lastFailureReason || '-' }}</td>
              <td class="actions">
                <button class="text-btn" type="button" @click="editEndpoint(endpoint)">编辑</button>
                <button class="text-btn" type="button" @click="toggleEndpoint(endpoint)">
                  {{ endpoint.enabled ? '停用' : '启用' }}
                </button>
                <button class="text-btn danger" type="button" @click="removeEndpoint(endpoint)">删除</button>
              </td>
            </tr>
            <tr v-if="!endpointLoading && siteEndpoints.length === 0">
              <td class="empty" colspan="6">暂无地址</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>
