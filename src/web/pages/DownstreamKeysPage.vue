<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useDialog } from 'naive-ui';
import { api, type Account, type AccountToken, type CredentialRef, type DownstreamKey, type DownstreamKeyBatchAction, type RouteItem, type Site } from '@web/api';

const keys = ref<DownstreamKey[]>([]);
const selectedKeyIds = ref<number[]>([]);
const sites = ref<Site[]>([]);
const accounts = ref<Account[]>([]);
const tokens = ref<AccountToken[]>([]);
const routes = ref<RouteItem[]>([]);
const loading = ref(false);
const saving = ref(false);
const error = ref('');
const message = ref('');
const createdKey = ref('');
const editingKeyId = ref<number | null>(null);
const dialog = useDialog();
const modelScopeOptions = [
  { label: '全部模型', value: 'all' },
  { label: '指定模型', value: 'selected' }
];

type DownstreamKeyForm = {
  name: string;
  description: string;
  enabled: boolean;
  expiresAt: string;
  maxCost: string;
  maxRequests: string;
  modelScope: 'all' | 'selected';
  supportedModelsText: string;
  allowedRouteIds: number[];
  allowedSiteIds: number[];
  allowedAccountIds: number[];
  allowedTokenIds: number[];
  excludedSiteIds: number[];
  excludedAccountIds: number[];
  excludedTokenIds: number[];
  siteWeightInputs: Record<string, string>;
};

const form = reactive<DownstreamKeyForm>({
  name: '',
  description: '',
  enabled: true,
  expiresAt: '',
  maxCost: '',
  maxRequests: '',
  modelScope: 'all',
  supportedModelsText: '',
  allowedRouteIds: [],
  allowedSiteIds: [],
  allowedAccountIds: [],
  allowedTokenIds: [],
  excludedSiteIds: [],
  excludedAccountIds: [],
  excludedTokenIds: [],
  siteWeightInputs: {}
});

function setError(err: unknown, fallback: string) {
  error.value = err instanceof Error ? err.message : fallback;
}

function resetForm() {
  editingKeyId.value = null;
  form.name = '';
  form.description = '';
  form.enabled = true;
  form.expiresAt = '';
  form.maxCost = '';
  form.maxRequests = '';
  form.modelScope = 'all';
  form.supportedModelsText = '';
  form.allowedRouteIds = [];
  form.allowedSiteIds = [];
  form.allowedAccountIds = [];
  form.allowedTokenIds = [];
  form.excludedSiteIds = [];
  form.excludedAccountIds = [];
  form.excludedTokenIds = [];
  form.siteWeightInputs = {};
  initSiteWeightInputs();
}

function dateTimeInputValue(value: string | null): string {
  return value ? value.slice(0, 16) : '';
}

function modelList() {
  return form.supportedModelsText
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatTime(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : '-';
}

function initSiteWeightInputs() {
  for (const site of sites.value) {
    const key = String(site.id);
    if (form.siteWeightInputs[key] === undefined) form.siteWeightInputs[key] = '';
  }
}

function accountLabel(account: Account) {
  return `${account.siteName || account.siteId} / ${account.username || account.id}`;
}

function tokenLabel(token: AccountToken) {
  return `${token.siteName || '-'} / ${token.accountName || token.accountId} / ${token.name}`;
}

function accountById(accountId: number) {
  return accounts.value.find((account) => account.id === accountId) || null;
}

function credentialRefs(accountIds: number[], tokenIds: number[]): CredentialRef[] {
  // 账号和内部凭据授权统一转换为后端 CredentialRef 结构。
  const refs: CredentialRef[] = [];
  for (const accountId of accountIds) {
    const account = accountById(accountId);
    if (account) refs.push({ kind: 'account', siteId: account.siteId, accountId: account.id });
  }
  for (const tokenId of tokenIds) {
    const token = tokens.value.find((item) => item.id === tokenId);
    const account = token ? accountById(token.accountId) : null;
    if (token && account) {
      refs.push({ kind: 'account_token', siteId: account.siteId, accountId: account.id, tokenId: token.id });
    }
  }
  return refs;
}

function accountIdsFromCredentialRefs(refs: CredentialRef[]): number[] {
  return refs.filter((ref) => ref.kind === 'account').map((ref) => ref.accountId);
}

function tokenIdsFromCredentialRefs(refs: CredentialRef[]): number[] {
  return refs.filter((ref) => ref.kind === 'account_token').map((ref) => ref.tokenId);
}

function siteWeightMultipliers() {
  const multipliers: Record<string, number> = {};
  for (const [siteId, value] of Object.entries(form.siteWeightInputs)) {
    const numberValue = Number(value);
    if (Number.isFinite(numberValue) && numberValue > 0 && numberValue !== 1) {
      multipliers[siteId] = numberValue;
    }
  }
  return multipliers;
}

function keyPolicySummary(key: DownstreamKey) {
  const parts = [
    key.allowedSiteIds.length > 0 ? `上游 ${key.allowedSiteIds.length}` : '',
    key.allowedCredentialRefs.length > 0 ? `凭据 ${key.allowedCredentialRefs.length}` : '',
    key.allowedRouteIds.length > 0 ? `路由 ${key.allowedRouteIds.length}` : '',
    key.excludedSiteIds.length > 0 || key.excludedCredentialRefs.length > 0 ? '含排除' : ''
  ].filter(Boolean);
  return parts.join(' / ') || '默认';
}

function keyWeightSummary(key: DownstreamKey) {
  const entries = Object.entries(key.siteWeightMultipliers);
  if (entries.length === 0) return '-';
  return entries.map(([siteId, value]) => `${siteId}:${value}`).join(', ');
}

function batchKeyActionLabel(action: DownstreamKeyBatchAction) {
  if (action === 'enable') return '启用';
  if (action === 'disable') return '停用';
  if (action === 'resetUsage') return '清用量';
  return '删除';
}

function isKeySelected(id: number) {
  return selectedKeyIds.value.includes(id);
}

function toggleKeySelection(id: number) {
  selectedKeyIds.value = isKeySelected(id)
    ? selectedKeyIds.value.filter((item) => item !== id)
    : [...selectedKeyIds.value, id];
}

function allVisibleKeysSelected() {
  return keys.value.length > 0 && keys.value.every((key) => selectedKeyIds.value.includes(key.id));
}

function toggleAllVisibleKeys() {
  const visibleIds = keys.value.map((key) => key.id);
  if (!allVisibleKeysSelected()) {
    selectedKeyIds.value = Array.from(new Set([...selectedKeyIds.value, ...visibleIds]));
  } else {
    selectedKeyIds.value = selectedKeyIds.value.filter((id) => !visibleIds.includes(id));
  }
}

function updateNumberSelection(list: number[], value: number, checked: boolean) {
  const index = list.indexOf(value);
  if (checked && index === -1) list.push(value);
  if (!checked && index !== -1) list.splice(index, 1);
}

function buildPayload() {
  return {
    name: form.name.trim(),
    description: form.description.trim() || null,
    enabled: form.enabled,
    expiresAt: form.expiresAt.trim() || null,
    maxCost: form.maxCost ? Number(form.maxCost) : null,
    maxRequests: form.maxRequests ? Number(form.maxRequests) : null,
    modelScope: form.modelScope,
    supportedModels: modelList(),
    allowedRouteIds: form.allowedRouteIds,
    allowedSiteIds: form.allowedSiteIds,
    allowedCredentialRefs: credentialRefs(form.allowedAccountIds, form.allowedTokenIds),
    siteWeightMultipliers: siteWeightMultipliers(),
    excludedSiteIds: form.excludedSiteIds,
    excludedCredentialRefs: credentialRefs(form.excludedAccountIds, form.excludedTokenIds)
  };
}

function editKey(key: DownstreamKey) {
  editingKeyId.value = key.id;
  createdKey.value = '';
  error.value = '';
  message.value = '';
  form.name = key.name;
  form.description = key.description || '';
  form.enabled = key.enabled;
  form.expiresAt = dateTimeInputValue(key.expiresAt);
  form.maxCost = key.maxCost === null ? '' : String(key.maxCost);
  form.maxRequests = key.maxRequests === null ? '' : String(key.maxRequests);
  form.modelScope = key.modelScope;
  form.supportedModelsText = key.supportedModels.join('\n');
  form.allowedRouteIds = [...key.allowedRouteIds];
  form.allowedSiteIds = [...key.allowedSiteIds];
  form.allowedAccountIds = accountIdsFromCredentialRefs(key.allowedCredentialRefs);
  form.allowedTokenIds = tokenIdsFromCredentialRefs(key.allowedCredentialRefs);
  form.excludedSiteIds = [...key.excludedSiteIds];
  form.excludedAccountIds = accountIdsFromCredentialRefs(key.excludedCredentialRefs);
  form.excludedTokenIds = tokenIdsFromCredentialRefs(key.excludedCredentialRefs);
  form.siteWeightInputs = {};
  for (const site of sites.value) {
    const siteId = String(site.id);
    form.siteWeightInputs[siteId] = key.siteWeightMultipliers[siteId] === undefined ? '' : String(key.siteWeightMultipliers[siteId]);
  }
}

async function loadKeys() {
  loading.value = true;
  error.value = '';
  try {
    const [keyData, siteData, accountData, tokenData, routeData] = await Promise.all([
      api.listDownstreamKeys(),
      api.listSites(),
      api.listAccounts(),
      api.listTokens(),
      api.listRoutes()
    ]);
    sites.value = siteData.items;
    accounts.value = accountData.items;
    tokens.value = tokenData.items;
    routes.value = routeData.items;
    initSiteWeightInputs();
    keys.value = keyData.items;
    selectedKeyIds.value = selectedKeyIds.value.filter((id) => keys.value.some((key) => key.id === id));
  } catch (err) {
    setError(err, '加载下游密钥失败');
  } finally {
    loading.value = false;
  }
}

async function submit() {
  saving.value = true;
  error.value = '';
  createdKey.value = '';
  try {
    const payload = buildPayload();
    if (editingKeyId.value) {
      await api.updateDownstreamKey(editingKeyId.value, payload);
      message.value = '密钥已保存';
    } else {
      const result = await api.createDownstreamKey(payload);
      // 明文密钥只在创建响应中返回，前端保留给用户立即复制。
      createdKey.value = result.key || '';
      message.value = '密钥已创建';
    }
    resetForm();
    await loadKeys();
  } catch (err) {
    setError(err, '保存下游密钥失败');
  } finally {
    saving.value = false;
  }
}

async function toggleKey(key: DownstreamKey) {
  error.value = '';
  message.value = '';
  try {
    await api.updateDownstreamKey(key.id, { enabled: !key.enabled });
    message.value = key.enabled ? '密钥已停用' : '密钥已启用';
    await loadKeys();
  } catch (err) {
    setError(err, '更新下游密钥失败');
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

function resetUsage(key: DownstreamKey) {
  confirmAction(`清零密钥 ${key.name} 的请求量和费用？`, async () => {
    error.value = '';
    message.value = '';
    try {
      await api.resetDownstreamKeyUsage(key.id);
      message.value = '密钥用量已清零';
      await loadKeys();
    } catch (err) {
      setError(err, '清零密钥用量失败');
    }
  });
}

async function batchUpdateKeys(action: DownstreamKeyBatchAction) {
  const ids = selectedKeyIds.value.slice();
  if (ids.length === 0) return;
  confirmAction(`批量${batchKeyActionLabel(action)} ${ids.length} 个密钥？`, async () => {
    saving.value = true;
    error.value = '';
    message.value = '';
    try {
      const result = await api.batchUpdateDownstreamKeys(ids, action);
      selectedKeyIds.value = [];
      message.value = `批量${batchKeyActionLabel(action)}完成：成功 ${result.successIds.length}，失败 ${result.failedItems.length}`;
      await loadKeys();
    } catch (err) {
      setError(err, '批量更新下游密钥失败');
    } finally {
      saving.value = false;
    }
  });
}

function removeKey(key: DownstreamKey) {
  confirmAction(`删除密钥 ${key.name}？`, async () => {
    error.value = '';
    message.value = '';
    try {
      await api.deleteDownstreamKey(key.id);
      message.value = '密钥已删除';
      await loadKeys();
    } catch (err) {
      setError(err, '删除下游密钥失败');
    }
  });
}

onMounted(loadKeys);
</script>

<template>
  <section class="page-stack">
    <n-card class="admin-card" :bordered="false">
      <div class="panel-header">
        <div>
          <h2>{{ editingKeyId ? '编辑下游密钥' : '下游密钥' }}</h2>
          <p class="muted">创建给客户端调用 `/v1/*` 的访问密钥。</p>
        </div>
      </div>
      <form class="form-grid" @submit.prevent="submit">
        <label class="field">
          <span>名称</span>
          <n-input v-model:value="form.name" required />
        </label>
        <label class="field">
          <span>模型范围</span>
          <n-select v-model:value="form.modelScope" :options="modelScopeOptions" />
        </label>
        <label class="field">
          <span>最大请求数</span>
          <n-input v-model:value="form.maxRequests" placeholder="不限" />
        </label>
        <label class="field">
          <span>费用上限</span>
          <n-input v-model:value="form.maxCost" placeholder="不限" />
        </label>
        <label class="field">
          <span>过期时间</span>
          <input class="native-input" v-model="form.expiresAt" type="datetime-local" />
        </label>
        <label class="check-row option-item">
          <n-checkbox v-model:checked="form.enabled">创建后启用</n-checkbox>
        </label>
        <label class="field wide">
          <span>说明</span>
          <n-input v-model:value="form.description" placeholder="可选" />
        </label>
        <label class="field wide">
          <span>指定模型</span>
          <n-input type="textarea" v-model:value="form.supportedModelsText" :rows="4" placeholder="每行一个模型"></n-input>
        </label>
        <div class="field wide">
          <span>允许路由</span>
          <div class="option-grid">
            <label v-for="route in routes" :key="route.id" class="check-row option-item">
              <n-checkbox
                :checked="form.allowedRouteIds.includes(route.id)"
                @update:checked="(checked) => updateNumberSelection(form.allowedRouteIds, route.id, checked)"
              >
                {{ route.displayName || route.modelPattern }}
              </n-checkbox>
            </label>
            <p v-if="routes.length === 0" class="muted">暂无路由</p>
          </div>
        </div>
        <div class="field wide">
          <span>允许上游地址</span>
          <div class="option-grid">
            <label v-for="site in sites" :key="site.id" class="check-row option-item">
              <n-checkbox
                :checked="form.allowedSiteIds.includes(site.id)"
                @update:checked="(checked) => updateNumberSelection(form.allowedSiteIds, site.id, checked)"
              >
                {{ site.name }}
              </n-checkbox>
            </label>
            <p v-if="sites.length === 0" class="muted">暂无上游地址</p>
          </div>
        </div>
        <div class="field wide">
          <span>允许账号</span>
          <div class="option-grid">
            <label v-for="account in accounts" :key="account.id" class="check-row option-item">
              <n-checkbox
                :checked="form.allowedAccountIds.includes(account.id)"
                @update:checked="(checked) => updateNumberSelection(form.allowedAccountIds, account.id, checked)"
              >
                {{ accountLabel(account) }}
              </n-checkbox>
            </label>
            <p v-if="accounts.length === 0" class="muted">暂无账号</p>
          </div>
        </div>
        <div class="field wide">
          <span>允许凭据</span>
          <div class="option-grid">
            <label v-for="token in tokens" :key="token.id" class="check-row option-item">
              <n-checkbox
                :checked="form.allowedTokenIds.includes(token.id)"
                @update:checked="(checked) => updateNumberSelection(form.allowedTokenIds, token.id, checked)"
              >
                {{ tokenLabel(token) }}
              </n-checkbox>
            </label>
            <p v-if="tokens.length === 0" class="muted">暂无凭据</p>
          </div>
        </div>
        <div class="field wide">
          <span>排除上游地址</span>
          <div class="option-grid">
            <label v-for="site in sites" :key="site.id" class="check-row option-item">
              <n-checkbox
                :checked="form.excludedSiteIds.includes(site.id)"
                @update:checked="(checked) => updateNumberSelection(form.excludedSiteIds, site.id, checked)"
              >
                {{ site.name }}
              </n-checkbox>
            </label>
            <p v-if="sites.length === 0" class="muted">暂无上游地址</p>
          </div>
        </div>
        <div class="field wide">
          <span>排除账号 / 凭据</span>
          <div class="option-grid">
            <label v-for="account in accounts" :key="account.id" class="check-row option-item">
              <n-checkbox
                :checked="form.excludedAccountIds.includes(account.id)"
                @update:checked="(checked) => updateNumberSelection(form.excludedAccountIds, account.id, checked)"
              >
                {{ accountLabel(account) }}
              </n-checkbox>
            </label>
            <label v-for="token in tokens" :key="`token-${token.id}`" class="check-row option-item">
              <n-checkbox
                :checked="form.excludedTokenIds.includes(token.id)"
                @update:checked="(checked) => updateNumberSelection(form.excludedTokenIds, token.id, checked)"
              >
                {{ tokenLabel(token) }}
              </n-checkbox>
            </label>
            <p v-if="accounts.length === 0 && tokens.length === 0" class="muted">暂无凭据</p>
          </div>
        </div>
        <div class="field wide">
          <span>上游权重倍率</span>
          <div class="weight-grid">
            <label v-for="site in sites" :key="site.id" class="field compact-field">
              <span>{{ site.name }}</span>
              <n-input v-model:value="form.siteWeightInputs[String(site.id)]" placeholder="1" />
            </label>
          </div>
        </div>
        <div class="form-actions wide">
          <n-button type="primary" attr-type="submit" :disabled="saving">
            {{ saving ? '保存中' : editingKeyId ? '保存修改' : '创建密钥' }}
          </n-button>
          <n-button secondary v-if="editingKeyId" attr-type="button" @click="resetForm">取消编辑</n-button>
        </div>
      </form>
      <n-alert v-if="createdKey" type="success" :bordered="false" class="mono">新密钥：{{ createdKey }}</n-alert>
      <n-alert v-if="message" type="success" :bordered="false">{{ message }}</n-alert>
      <n-alert v-if="error" type="error" :bordered="false">{{ error }}</n-alert>
    </n-card>

    <n-card class="admin-card" :bordered="false">
      <div class="panel-header">
        <h2>密钥列表</h2>
        <n-button secondary attr-type="button" @click="loadKeys">刷新</n-button>
      </div>
      <div class="toolbar">
        <n-button secondary attr-type="button" :disabled="selectedKeyIds.length === 0 || saving" @click="batchUpdateKeys('enable')">批量启用</n-button>
        <n-button secondary attr-type="button" :disabled="selectedKeyIds.length === 0 || saving" @click="batchUpdateKeys('disable')">批量停用</n-button>
        <n-button secondary attr-type="button" :disabled="selectedKeyIds.length === 0 || saving" @click="batchUpdateKeys('resetUsage')">批量清用量</n-button>
        <n-button secondary attr-type="button" :disabled="selectedKeyIds.length === 0 || saving" @click="batchUpdateKeys('delete')">批量删除</n-button>
        <span class="muted">已选 {{ selectedKeyIds.length }}</span>
      </div>
      <div class="table-wrap">
        <n-table size="small" :bordered="false" single-line class="admin-table">
          <thead>
            <tr>
              <th>
                <n-checkbox :checked="allVisibleKeysSelected()" :disabled="keys.length === 0" @update:checked="toggleAllVisibleKeys" />
              </th>
              <th>名称</th>
              <th>密钥</th>
              <th>范围</th>
              <th>授权</th>
              <th>权重</th>
              <th>请求量</th>
              <th>费用</th>
              <th>过期</th>
              <th>最近使用</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="key in keys" :key="key.id" :class="{ selected: isKeySelected(key.id) }">
              <td>
                <n-checkbox :checked="isKeySelected(key.id)" @update:checked="toggleKeySelection(key.id)" />
              </td>
              <td>{{ key.name }}</td>
              <td class="mono">{{ key.keyMasked }}</td>
              <td>{{ key.modelScope === 'all' ? '全部' : key.supportedModels.join(', ') || '指定' }}</td>
              <td>{{ keyPolicySummary(key) }}</td>
              <td class="mono">{{ keyWeightSummary(key) }}</td>
              <td>{{ key.usedRequests }} / {{ key.maxRequests ?? '不限' }}</td>
              <td>{{ key.usedCost }} / {{ key.maxCost ?? '不限' }}</td>
              <td>{{ formatTime(key.expiresAt) }}</td>
              <td>{{ formatTime(key.lastUsedAt) }}</td>
              <td>
                <n-tag size="small" :type="key.enabled ? 'success' : 'error'">{{ key.enabled ? '启用' : '停用' }}</n-tag>
              </td>
              <td class="actions">
                <n-button text attr-type="button" @click="editKey(key)">编辑</n-button>
                <n-button text attr-type="button" @click="toggleKey(key)">{{ key.enabled ? '停用' : '启用' }}</n-button>
                <n-button text attr-type="button" @click="resetUsage(key)">清用量</n-button>
                <n-button type="error" text attr-type="button" @click="removeKey(key)">删除</n-button>
              </td>
            </tr>
            <tr v-if="!loading && keys.length === 0">
              <td class="empty" colspan="12">暂无密钥</td>
            </tr>
          </tbody>
        </n-table>
      </div>
    </n-card>
  </section>
</template>

<style scoped lang="scss">
.option-grid,
.weight-grid {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.option-item {
  min-height: 38px;
  align-items: flex-start;
  border: 1px solid #d6dde8;
  border-radius: 8px;
  background: #f8fafc;
  padding: 9px 10px;
  color: #38465a;
  font-weight: 600;
}

.option-item span {
  min-width: 0;
  overflow-wrap: anywhere;
}

.compact-field {
  gap: 5px;
}

@media (max-width: 900px) {
  .option-grid,
  .weight-grid {
    grid-template-columns: 1fr;
  }
}
</style>
