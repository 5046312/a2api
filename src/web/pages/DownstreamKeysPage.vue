<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue';
import { useDialog, useMessage } from 'naive-ui';
import { api, type Account, type CredentialRef, type DownstreamKey, type DownstreamKeyBatchAction, type RouteItem } from '@web/api';

const keys = ref<DownstreamKey[]>([]);
const selectedKeyIds = ref<number[]>([]);
const accounts = ref<Account[]>([]);
const routes = ref<RouteItem[]>([]);
const loading = ref(false);
const saving = ref(false);
const error = ref('');
const message = ref('');
const createdKey = ref('');
const editingKeyId = ref<number | null>(null);
const dialog = useDialog();
const notice = useMessage();
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
  allowedAccountIds: number[];
  excludedAccountIds: number[];
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
  allowedAccountIds: [],
  excludedAccountIds: []
});

watch(message, (value) => {
  if (value) notice.success(value);
});

watch(error, (value) => {
  if (value) notice.error(value);
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
  form.allowedAccountIds = [];
  form.excludedAccountIds = [];
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

function accountLabel(account: Account) {
  return account.name || account.username || `上游账号 ${account.id}`;
}

function accountById(accountId: number) {
  return accounts.value.find((account) => account.id === accountId) || null;
}

function credentialRefs(accountIds: number[]): CredentialRef[] {
  // 下游策略只暴露上游账号授权，后端兼容字段仍用 CredentialRef 承载。
  const refs: CredentialRef[] = [];
  for (const accountId of accountIds) {
    const account = accountById(accountId);
    if (account) refs.push({ kind: 'account', siteId: account.siteId, accountId: account.id });
  }
  return refs;
}

function accountIdsFromCredentialRefs(refs: CredentialRef[]): number[] {
  return Array.from(new Set(refs.map((ref) => ref.accountId)));
}

function keyPolicySummary(key: DownstreamKey) {
  const allowedAccountCount = accountIdsFromCredentialRefs(key.allowedCredentialRefs).length;
  const excludedAccountCount = accountIdsFromCredentialRefs(key.excludedCredentialRefs).length;
  const parts = [
    allowedAccountCount > 0 ? `上游账号 ${allowedAccountCount}` : '',
    key.allowedRouteIds.length > 0 ? `模型 ${key.allowedRouteIds.length}` : '',
    excludedAccountCount > 0 ? '含排除' : ''
  ].filter(Boolean);
  return parts.join(' / ') || '默认';
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
    allowedSiteIds: [],
    allowedCredentialRefs: credentialRefs(form.allowedAccountIds),
    siteWeightMultipliers: {},
    excludedSiteIds: [],
    excludedCredentialRefs: credentialRefs(form.excludedAccountIds)
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
  form.allowedAccountIds = accountIdsFromCredentialRefs(key.allowedCredentialRefs);
  form.excludedAccountIds = accountIdsFromCredentialRefs(key.excludedCredentialRefs);
}

async function loadKeys() {
  loading.value = true;
  error.value = '';
  try {
    const [keyData, accountData, routeData] = await Promise.all([
      api.listDownstreamKeys(),
      api.listAccounts(),
      api.listRoutes()
    ]);
    accounts.value = accountData.items;
    routes.value = routeData.items;
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
          <span>允许模型</span>
          <div class="option-grid">
            <label v-for="route in routes" :key="route.id" class="check-row option-item">
              <n-checkbox
                :checked="form.allowedRouteIds.includes(route.id)"
                @update:checked="(checked) => updateNumberSelection(form.allowedRouteIds, route.id, checked)"
              >
                {{ route.displayName || route.modelPattern }}
              </n-checkbox>
            </label>
            <p v-if="routes.length === 0" class="muted">暂无模型</p>
          </div>
        </div>
        <div class="field wide">
          <span>允许上游账号</span>
          <div class="option-grid">
            <label v-for="account in accounts" :key="account.id" class="check-row option-item">
              <n-checkbox
                :checked="form.allowedAccountIds.includes(account.id)"
                @update:checked="(checked) => updateNumberSelection(form.allowedAccountIds, account.id, checked)"
              >
                {{ accountLabel(account) }}
              </n-checkbox>
            </label>
            <p v-if="accounts.length === 0" class="muted">暂无上游账号</p>
          </div>
        </div>
        <div class="field wide">
          <span>排除上游账号</span>
          <div class="option-grid">
            <label v-for="account in accounts" :key="account.id" class="check-row option-item">
              <n-checkbox
                :checked="form.excludedAccountIds.includes(account.id)"
                @update:checked="(checked) => updateNumberSelection(form.excludedAccountIds, account.id, checked)"
              >
                {{ accountLabel(account) }}
              </n-checkbox>
            </label>
            <p v-if="accounts.length === 0" class="muted">暂无上游账号</p>
          </div>
        </div>
        <div class="form-actions wide">
          <n-button type="primary" attr-type="submit" :disabled="saving">
            {{ saving ? '保存中' : editingKeyId ? '保存修改' : '创建密钥' }}
          </n-button>
          <n-button secondary v-if="editingKeyId" attr-type="button" @click="resetForm">取消编辑</n-button>
        </div>
      </form>
      <pre v-if="createdKey" class="code-block">新密钥：{{ createdKey }}</pre>
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
              <td class="empty" colspan="11">暂无密钥</td>
            </tr>
          </tbody>
        </n-table>
      </div>
    </n-card>
  </section>
</template>

<style scoped lang="scss">
.option-grid {
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

@media (max-width: 900px) {
  .option-grid {
    grid-template-columns: 1fr;
  }
}
</style>
