<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useDialog, useMessage } from 'naive-ui';
import { api, type Account, type AccountBatchAction } from '@web/api';

const defaultPlatformOptions = [
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
];

const openaiPresetModels = [
  'gpt-5.2',
  'gpt-5.4',
  'gpt-5.5',
  'gpt-5.3-codex',
  'gpt-5.3-codex-spark',
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4.1',
  'o1',
  'o3'
];
const claudePresetModels = [
  'claude-fable-5',
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'claude-sonnet-4-5',
  'claude-haiku-4-5'
];
const geminiPresetModels = [
  'gemini-3.1-flash-image',
  'gemini-3-flash-preview',
  'gemini-3-pro-preview',
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.0-flash'
];
const antigravityPresetModels = [
  'claude-fable-5',
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-opus-4-6-thinking',
  'claude-sonnet-4-6',
  'claude-sonnet-4-5',
  'gemini-3.1-pro-high',
  'gemini-3.1-pro-low',
  'gemini-3-flash',
  'gemini-2.5-flash'
];
const openaiCompatiblePlatforms = new Set([
  'openai',
  'new-api',
  'one-api',
  'one-hub',
  'done-hub',
  'veloera',
  'anyrouter',
  'sub2api',
  'cliproxyapi',
  'codex'
]);

const accounts = ref<Account[]>([]);
const platformOptions = ref(defaultPlatformOptions);
const loading = ref(false);
const saving = ref(false);
const detecting = ref(false);
const verifying = ref(false);
const refreshingBalanceId = ref<number | null>(null);
const refreshingAllBalances = ref(false);
const editingAccountId = ref<number | null>(null);
const showAccountDrawer = ref(false);
const showModelDrawer = ref(false);
const showAdvanced = ref(false);
const modelDrawerAccount = ref<Account | null>(null);
const accountModels = ref<string[]>([]);
const customModelName = ref('');
const loadingModels = ref(false);
const savingModels = ref(false);
const syncingModels = ref(false);
const syncModelModalVisible = ref(false);
const syncModelOptions = ref<string[]>([]);
const selectedSyncModels = ref<string[]>([]);
const modelDrawerError = ref('');
const modelDrawerMessage = ref('');
const selectedAccountIds = ref<number[]>([]);
const updatingStatusAccountId = ref<number | null>(null);
const error = ref('');
const message = ref('');
const dialog = useDialog();
const notice = useMessage();
const accountForm = reactive({
  name: '',
  baseUrl: '',
  platform: 'openai',
  apiKey: '',
  credentialMode: 'apikey',
  unitCost: '',
  proxyUrl: '',
  useSystemProxy: false,
  customHeadersText: '',
  status: 'active',
  isPinned: false,
  sortOrder: 0
});
const accountPlatformOptions = computed(() => {
  const current = accountForm.platform.trim();
  if (!current || platformOptions.value.includes(current)) return platformOptions.value;
  return [...platformOptions.value, current];
});
const accountPlatformSelectOptions = computed(() =>
  accountPlatformOptions.value.map((platform) => ({ label: platform, value: platform }))
);
const accountStatusOptions = [
  { label: '启用', value: 'active' },
  { label: '停用', value: 'disabled' },
  { label: '过期', value: 'expired' }
];
const credentialModeOptions = [
  { label: 'API Key', value: 'apikey' },
  { label: 'Session', value: 'session' },
  { label: 'OAuth', value: 'oauth' },
  { label: 'Auto', value: 'auto' }
];
const expiredStatusActionOptions = [
  { label: '恢复启用', key: 'active' },
  { label: '改为停用', key: 'disabled' }
];
const modelPresetOptions = computed(() =>
  presetModelsForPlatform(modelDrawerAccount.value?.platform).filter((model) => !accountModels.value.includes(model))
);
const allSyncModelsSelected = computed(() =>
  syncModelOptions.value.length > 0 && syncModelOptions.value.every((model) => selectedSyncModels.value.includes(model))
);

type AccountToggleStatus = 'active' | 'disabled';
type PendingExpiredStatusAction = {
  account: Account;
  nextStatus: AccountToggleStatus;
};

const pendingExpiredStatusAction = ref<PendingExpiredStatusAction | null>(null);

watch(message, (value) => {
  if (value) notice.success(value);
});

watch(error, (value) => {
  if (value) notice.error(value);
});

watch(modelDrawerMessage, (value) => {
  if (value) notice.success(value);
});

watch(modelDrawerError, (value) => {
  if (value) notice.error(value);
});

function setError(err: unknown, fallback: string) {
  error.value = err instanceof Error ? err.message : fallback;
}

function formatNumber(value: number | null | undefined) {
  return Number(value || 0).toFixed(2);
}

function formatTime(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : '-';
}

function accountLabel(account: Account) {
  return account.name || account.username || `上游账号 ${account.id}`;
}

function modelActionLabel(account: Account) {
  return account.modelCount > 0 ? `模型(${account.modelCount})` : '模型';
}

function accountStatusLabel(status: string) {
  if (status === 'active') return '启用';
  if (status === 'disabled') return '停用';
  if (status === 'expired') return '过期';
  return status || '-';
}

function accountStatusTagType(status: string) {
  if (status === 'active') return 'success';
  if (status === 'expired') return 'warning';
  return 'error';
}

function toggleStatusTarget(status: string): AccountToggleStatus | null {
  if (status === 'active') return 'disabled';
  if (status === 'disabled') return 'active';
  return null;
}

function statusToggleConfirmText(status: string) {
  if (status === 'active') return '确认停用该上游账号？';
  if (status === 'disabled') return '确认启用该上游账号？';
  return '';
}

function expiredStatusConfirmText() {
  const action = pendingExpiredStatusAction.value;
  if (!action) return '';
  if (action.nextStatus === 'active') {
    return `确认恢复启用上游账号 ${accountLabel(action.account)}？`;
  }
  return `确认将上游账号 ${accountLabel(action.account)} 改为停用？`;
}

function statusActionDisabled() {
  return saving.value || updatingStatusAccountId.value !== null;
}

function presetModelsForPlatform(platform: string | null | undefined) {
  const normalized = platform?.toLowerCase().trim() || '';
  if (normalized === 'antigravity') return antigravityPresetModels;
  if (normalized === 'gemini' || normalized === 'gemini-cli') return geminiPresetModels;
  if (normalized === 'claude') return claudePresetModels;
  if (openaiCompatiblePlatforms.has(normalized)) return openaiPresetModels;
  return Array.from(new Set([...openaiPresetModels, ...claudePresetModels, ...geminiPresetModels]));
}

function sortModelNames(models: string[]) {
  return models.slice().sort((left, right) => left.localeCompare(right));
}

function batchAccountActionLabel(action: AccountBatchAction) {
  const labels: Record<AccountBatchAction, string> = {
    enable: '启用',
    disable: '停用',
    delete: '删除',
    refreshBalance: '刷新余额'
  };
  return labels[action];
}

function isAccountSelected(id: number) {
  return selectedAccountIds.value.includes(id);
}

function toggleAccountSelection(id: number) {
  selectedAccountIds.value = isAccountSelected(id)
    ? selectedAccountIds.value.filter((item) => item !== id)
    : [...selectedAccountIds.value, id];
}

function allVisibleAccountsSelected() {
  return accounts.value.length > 0 && accounts.value.every((account) => selectedAccountIds.value.includes(account.id));
}

function toggleAllVisibleAccounts() {
  const visibleIds = accounts.value.map((account) => account.id);
  if (!allVisibleAccountsSelected()) {
    selectedAccountIds.value = Array.from(new Set([...selectedAccountIds.value, ...visibleIds]));
  } else {
    selectedAccountIds.value = selectedAccountIds.value.filter((id) => !visibleIds.includes(id));
  }
}

function resetAccountForm() {
  editingAccountId.value = null;
  showAdvanced.value = false;
  accountForm.name = '';
  accountForm.baseUrl = '';
  accountForm.platform = 'openai';
  accountForm.apiKey = '';
  accountForm.credentialMode = 'apikey';
  accountForm.unitCost = '';
  accountForm.proxyUrl = '';
  accountForm.useSystemProxy = false;
  accountForm.customHeadersText = '';
  accountForm.status = 'active';
  accountForm.isPinned = false;
  accountForm.sortOrder = accounts.value.length;
}

function openCreateAccount() {
  resetAccountForm();
  error.value = '';
  message.value = '';
  showAccountDrawer.value = true;
}

function closeAccountDrawer() {
  if (saving.value) return;
  showAccountDrawer.value = false;
}

function editAccount(account: Account) {
  editingAccountId.value = account.id;
  error.value = '';
  message.value = '';
  accountForm.name = account.name || account.username || '';
  accountForm.baseUrl = account.baseUrl || '';
  accountForm.platform = account.platform || 'openai';
  accountForm.credentialMode = account.credentialMode;
  accountForm.apiKey = '';
  accountForm.unitCost = account.unitCost === null ? '' : String(account.unitCost);
  accountForm.proxyUrl = account.proxyUrl || '';
  accountForm.useSystemProxy = account.useSystemProxy;
  accountForm.customHeadersText = account.customHeaders ? JSON.stringify(account.customHeaders, null, 2) : '';
  accountForm.status = account.status;
  accountForm.isPinned = account.isPinned;
  accountForm.sortOrder = account.sortOrder;
  showAdvanced.value = true;
  showAccountDrawer.value = true;
}

function resetModelDrawer() {
  modelDrawerAccount.value = null;
  accountModels.value = [];
  customModelName.value = '';
  syncModelModalVisible.value = false;
  syncModelOptions.value = [];
  selectedSyncModels.value = [];
  modelDrawerError.value = '';
  modelDrawerMessage.value = '';
}

function closeModelDrawer() {
  if (savingModels.value || syncingModels.value) return;
  showModelDrawer.value = false;
}

function openModelDrawer(account: Account) {
  modelDrawerAccount.value = account;
  accountModels.value = [];
  customModelName.value = '';
  modelDrawerError.value = '';
  modelDrawerMessage.value = '';
  showModelDrawer.value = true;
  void loadAccountModels(account.id);
}

async function loadAccountModels(accountId: number) {
  loadingModels.value = true;
  modelDrawerError.value = '';
  try {
    const result = await api.listAccountModels(accountId);
    accountModels.value = sortModelNames(result.models);
  } catch (err) {
    modelDrawerError.value = err instanceof Error ? err.message : '加载上游账号模型失败';
  } finally {
    loadingModels.value = false;
  }
}

function addModel(model: string) {
  const modelName = model.trim();
  if (!modelName) return;
  if (accountModels.value.includes(modelName)) {
    modelDrawerMessage.value = '模型已存在';
    return;
  }
  accountModels.value = sortModelNames([...accountModels.value, modelName]);
  customModelName.value = '';
  modelDrawerMessage.value = '';
}

function removeModel(model: string) {
  accountModels.value = accountModels.value.filter((item) => item !== model);
}

function clearModelDraft() {
  accountModels.value = [];
  modelDrawerMessage.value = '已清空当前模型草稿，保存后生效';
}

function isSyncModelSelected(model: string) {
  return selectedSyncModels.value.includes(model);
}

function toggleSyncModel(model: string, checked: boolean) {
  selectedSyncModels.value = checked
    ? Array.from(new Set([...selectedSyncModels.value, model]))
    : selectedSyncModels.value.filter((item) => item !== model);
}

function toggleAllSyncModels(checked: boolean) {
  selectedSyncModels.value = checked ? syncModelOptions.value.slice() : [];
}

async function syncAccountModels() {
  const account = modelDrawerAccount.value;
  if (!account) return;
  syncingModels.value = true;
  modelDrawerError.value = '';
  modelDrawerMessage.value = '';
  try {
    const result = await api.previewAccountModels(account.id);
    syncModelOptions.value = sortModelNames(result.models);
    selectedSyncModels.value = syncModelOptions.value.slice();
    syncModelModalVisible.value = true;
  } catch (err) {
    modelDrawerError.value = err instanceof Error ? err.message : '同步上游模型失败';
  } finally {
    syncingModels.value = false;
  }
}

function confirmSyncModels() {
  accountModels.value = sortModelNames(selectedSyncModels.value);
  modelDrawerMessage.value = `已选择 ${accountModels.value.length} 个上游模型，保存后生效`;
  syncModelModalVisible.value = false;
}

async function saveAccountModels() {
  const account = modelDrawerAccount.value;
  if (!account) return;
  savingModels.value = true;
  modelDrawerError.value = '';
  modelDrawerMessage.value = '';
  try {
    const result = await api.updateAccountModels(account.id, accountModels.value);
    accountModels.value = sortModelNames(result.models);
    message.value = `上游账号模型已保存：${result.models.length} 个`;
    showModelDrawer.value = false;
    await loadAll();
  } catch (err) {
    modelDrawerError.value = err instanceof Error ? err.message : '保存上游账号模型失败';
  } finally {
    savingModels.value = false;
  }
}

async function loadAll() {
  loading.value = true;
  error.value = '';
  try {
    const accountData = await api.listAccounts();
    accounts.value = accountData.items;
    selectedAccountIds.value = selectedAccountIds.value.filter((id) => accounts.value.some((account) => account.id === id));
  } catch (err) {
    setError(err, '加载上游账号失败');
  } finally {
    loading.value = false;
  }
}

async function loadPlatformOptions() {
  try {
    const data = await api.getBrandList();
    if (Array.isArray(data.brands) && data.brands.length > 0) {
      platformOptions.value = data.brands;
    }
  } catch {
    // 平台列表加载失败时保留默认选项，避免上游账号表单不可用。
  }
}

function parseCustomHeaders(): Record<string, string> | null {
  if (!accountForm.customHeadersText.trim()) return null;
  const parsed = JSON.parse(accountForm.customHeadersText) as unknown;
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

async function detectPlatform() {
  if (!accountForm.baseUrl.trim()) {
    error.value = '请输入接口地址';
    return;
  }
  detecting.value = true;
  error.value = '';
  try {
    const result = await api.detectAccountPlatform(accountForm.baseUrl.trim());
    if (result.platform) {
      accountForm.platform = result.platform;
      message.value = `已识别平台：${result.platform}`;
    } else {
      message.value = result.message;
    }
  } catch (err) {
    setError(err, '检测平台失败');
  } finally {
    detecting.value = false;
  }
}

async function verifyApiKey() {
  const apiKey = accountForm.apiKey.trim();
  if (!accountForm.baseUrl.trim() || !apiKey) {
    error.value = '请先填写接口地址和 API Key';
    return;
  }
  verifying.value = true;
  error.value = '';
  message.value = '';
  try {
    const payload: Record<string, unknown> = {
      baseUrl: accountForm.baseUrl.trim(),
      platform: accountForm.platform.trim(),
      apiKey,
      credentialMode: accountForm.credentialMode
    };
    if (showAdvanced.value) {
      payload.proxyUrl = accountForm.proxyUrl.trim() || null;
      payload.customHeaders = parseCustomHeaders();
    }
    const result = await api.verifyAccountApiKey(payload) as { ok?: boolean; models?: unknown[] };
    message.value = result.ok ? `验证通过，发现 ${result.models?.length || 0} 个模型` : '验证完成，但未确认 API Key 类型';
  } catch (err) {
    setError(err, '验证 API Key 失败');
  } finally {
    verifying.value = false;
  }
}

async function createAccount() {
  saving.value = true;
  error.value = '';
  message.value = '';
  try {
    const payload: Record<string, unknown> = {
      name: accountForm.name.trim() || null,
      baseUrl: accountForm.baseUrl.trim(),
      platform: accountForm.platform.trim(),
      credentialMode: accountForm.credentialMode,
      status: accountForm.status
    };
    if (showAdvanced.value) {
      Object.assign(payload, {
        unitCost: accountForm.unitCost ? Number(accountForm.unitCost) : null,
        proxyUrl: accountForm.proxyUrl.trim() || null,
        useSystemProxy: accountForm.useSystemProxy,
        customHeaders: parseCustomHeaders(),
        isPinned: accountForm.isPinned,
        sortOrder: Number(accountForm.sortOrder) || 0
      });
    }
    const apiKey = accountForm.apiKey.trim();
    if (editingAccountId.value) {
      if (apiKey) payload.apiKey = apiKey;
      await api.updateAccount(editingAccountId.value, payload);
      message.value = '上游账号已更新';
    } else {
      if (!apiKey) {
        error.value = '请输入 API Key';
        return;
      }
      payload.apiKey = apiKey;
      await api.createAccount(payload);
      message.value = '上游账号已创建';
    }
    showAccountDrawer.value = false;
    await loadAll();
  } catch (err) {
    setError(err, '保存上游账号失败');
  } finally {
    saving.value = false;
  }
}

async function refreshBalance(account: Account) {
  refreshingBalanceId.value = account.id;
  error.value = '';
  message.value = '';
  try {
    const result = await api.refreshBalance(account.id);
    message.value = result.skipped
      ? `余额刷新跳过：${result.reason || 'unsupported'}`
      : `余额刷新完成：${formatNumber(result.balance)}`;
    await loadAll();
  } catch (err) {
    setError(err, '刷新余额失败');
  } finally {
    refreshingBalanceId.value = null;
  }
}

async function refreshAllBalances() {
  refreshingAllBalances.value = true;
  error.value = '';
  message.value = '';
  try {
    const result = await api.refreshAllBalances();
    message.value = `批量余额刷新完成：成功 ${result.succeeded}，跳过 ${result.skipped}，失败 ${result.failed}`;
    await loadAll();
  } catch (err) {
    setError(err, '批量刷新余额失败');
  } finally {
    refreshingAllBalances.value = false;
  }
}

async function updateAccountStatus(account: Account, nextStatus: AccountToggleStatus) {
  if (statusActionDisabled()) return;
  updatingStatusAccountId.value = account.id;
  error.value = '';
  message.value = '';
  try {
    await api.updateAccount(account.id, { status: nextStatus });
    message.value = nextStatus === 'active' ? '上游账号已启用' : '上游账号已停用';
    pendingExpiredStatusAction.value = null;
    await loadAll();
  } catch (err) {
    setError(err, '更新上游账号状态失败');
  } finally {
    updatingStatusAccountId.value = null;
  }
}

async function toggleAccountStatus(account: Account) {
  const nextStatus = toggleStatusTarget(account.status);
  if (!nextStatus) return;
  await updateAccountStatus(account, nextStatus);
}

function selectExpiredStatusAction(account: Account, key: string | number) {
  if (statusActionDisabled()) return;
  if (key !== 'active' && key !== 'disabled') return;
  // 过期状态先选动作，再进入确认弹层。
  pendingExpiredStatusAction.value = {
    account,
    nextStatus: key
  };
}

function closeExpiredStatusModal() {
  if (updatingStatusAccountId.value !== null) return;
  pendingExpiredStatusAction.value = null;
}

async function confirmExpiredStatusAction() {
  const action = pendingExpiredStatusAction.value;
  if (!action) return;
  await updateAccountStatus(action.account, action.nextStatus);
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

function removeAccount(account: Account) {
  confirmAction(`删除上游账号 ${accountLabel(account)}？`, async () => {
    error.value = '';
    try {
      await api.deleteAccount(account.id);
      await loadAll();
    } catch (err) {
      setError(err, '删除上游账号失败');
    }
  });
}

async function batchUpdateAccounts(action: AccountBatchAction) {
  const ids = selectedAccountIds.value.slice();
  if (ids.length === 0) return;
  confirmAction(`批量${batchAccountActionLabel(action)} ${ids.length} 个上游账号？`, async () => {
    saving.value = true;
    error.value = '';
    message.value = '';
    try {
      const result = await api.batchUpdateAccounts(ids, action);
      selectedAccountIds.value = [];
      message.value = `批量${batchAccountActionLabel(action)}完成：成功 ${result.successIds.length}，失败 ${result.failedItems.length}`;
      await loadAll();
    } catch (err) {
      setError(err, '批量更新上游账号失败');
    } finally {
      saving.value = false;
    }
  });
}

onMounted(() => {
  void loadPlatformOptions();
  void loadAll();
});
</script>

<template>
  <section class="page-stack">
    <n-drawer
      v-model:show="showAccountDrawer"
      placement="right"
      width="min(760px, calc(100vw - 24px))"
      :mask-closable="!saving"
      :close-on-esc="!saving"
      @after-leave="resetAccountForm"
    >
      <n-drawer-content :title="editingAccountId ? '编辑上游账号' : '新增上游账号'" :closable="!saving">
        <p class="muted">维护上游账号的接口地址和 API Key。</p>
        <form class="form-grid single" @submit.prevent="createAccount">
          <label class="field">
            <span>名称</span>
            <n-input v-model:value="accountForm.name" placeholder="OpenAI 主账号" />
          </label>
          <label class="field">
            <span>接口地址</span>
            <n-input v-model:value="accountForm.baseUrl" placeholder="https://api.openai.com" required />
          </label>
          <label class="field">
            <span>平台</span>
            <n-select v-model:value="accountForm.platform" filterable :options="accountPlatformSelectOptions" />
          </label>
          <label class="field">
            <span>API Key</span>
            <n-input v-model:value="accountForm.apiKey" type="password" :required="!editingAccountId" :placeholder="editingAccountId ? '留空则不修改' : ''" />
          </label>
          <label class="field">
            <span>状态</span>
            <n-select v-model:value="accountForm.status" :options="accountStatusOptions" />
          </label>
          <label class="check-row">
            <n-checkbox v-model:checked="showAdvanced">显示高级配置</n-checkbox>
          </label>
          <template v-if="showAdvanced">
            <label class="field">
              <span>认证方式</span>
              <n-select v-model:value="accountForm.credentialMode" :options="credentialModeOptions" />
            </label>
            <label class="field">
              <span>单位成本</span>
              <n-input v-model:value="accountForm.unitCost" placeholder="每 100 万用量单位" />
            </label>
            <label class="field">
              <span>上游账号代理</span>
              <n-input v-model:value="accountForm.proxyUrl" placeholder="http://127.0.0.1:7890" />
            </label>
            <label class="check-row">
              <n-checkbox v-model:checked="accountForm.useSystemProxy">使用系统代理</n-checkbox>
            </label>
            <label class="field">
              <span>自定义 Header</span>
              <n-input type="textarea" v-model:value="accountForm.customHeadersText" :rows="4" placeholder='{"x-api-key":"value"}'></n-input>
            </label>
            <label class="field">
              <span>排序</span>
              <n-input-number v-model:value="accountForm.sortOrder" :min="0" :step="1" />
            </label>
            <label class="check-row">
              <n-checkbox v-model:checked="accountForm.isPinned">置顶上游账号</n-checkbox>
            </label>
          </template>
          <div class="form-actions">
            <n-button type="primary" attr-type="submit" :disabled="saving">
              {{ saving ? '保存中' : editingAccountId ? '保存修改' : '创建上游账号' }}
            </n-button>
            <n-button secondary attr-type="button" :disabled="detecting" @click="detectPlatform">
              {{ detecting ? '检测中' : '检测平台' }}
            </n-button>
            <n-button secondary attr-type="button" :disabled="verifying" @click="verifyApiKey">
              {{ verifying ? '验证中' : '验证 API Key' }}
            </n-button>
            <n-button secondary attr-type="button" :disabled="saving" @click="closeAccountDrawer">取消</n-button>
          </div>
        </form>
      </n-drawer-content>
    </n-drawer>

    <n-drawer
      v-model:show="showModelDrawer"
      placement="right"
      width="min(820px, calc(100vw - 24px))"
      :mask-closable="!savingModels && !syncingModels"
      :close-on-esc="!savingModels && !syncingModels"
      @after-leave="resetModelDrawer"
    >
      <n-drawer-content :title="modelDrawerAccount ? `上游账号模型：${accountLabel(modelDrawerAccount)}` : '上游账号模型'" :closable="!savingModels && !syncingModels">
        <div class="model-drawer-stack">
          <p class="muted">维护该上游账号固定可用模型。保存后会重建模型。</p>

          <n-spin :show="loadingModels">
            <section class="model-drawer-section">
              <div class="panel-header">
                <div>
                  <h2>模型白名单</h2>
                  <p class="muted">{{ accountModels.length }} 个模型</p>
                </div>
                <n-button secondary type="error" attr-type="button" :disabled="loadingModels || accountModels.length === 0" @click="clearModelDraft">清空所有模型</n-button>
              </div>

              <div v-if="accountModels.length > 0" class="model-chip-grid">
                <div v-for="model in accountModels" :key="model" class="model-chip-item">
                  <span class="model-chip-name">{{ model }}</span>
                  <button class="model-chip-remove" type="button" @click="removeModel(model)">×</button>
                </div>
              </div>
              <div v-else class="model-empty">暂无固定模型，保存空列表后该上游账号不会生成自动通道。</div>
            </section>

            <section class="model-drawer-section">
              <label class="field">
                <span>添加自定义模型</span>
                <div class="model-input-row">
                  <n-input v-model:value="customModelName" placeholder="gpt-5.5" :disabled="loadingModels" @keydown.enter.prevent="addModel(customModelName)" />
                  <n-button type="primary" attr-type="button" :disabled="loadingModels" @click="addModel(customModelName)">添加</n-button>
                </div>
              </label>
            </section>

            <section class="model-drawer-section">
              <div class="panel-header">
                <div>
                  <h2>平台预设</h2>
                  <p class="muted">参考 sub2api 常用模型列表。</p>
                </div>
              </div>
              <div v-if="modelPresetOptions.length > 0" class="preset-models">
                <n-button
                  v-for="model in modelPresetOptions"
                  :key="model"
                  secondary
                  size="small"
                  attr-type="button"
                  :disabled="loadingModels"
                  @click="addModel(model)"
                >
                  + {{ model }}
                </n-button>
              </div>
              <div v-else class="model-empty compact">当前平台预设都已添加。</div>
            </section>
          </n-spin>

          <div class="model-drawer-footer">
            <n-button secondary attr-type="button" :disabled="loadingModels || syncingModels || savingModels" @click="syncAccountModels">
              {{ syncingModels ? '同步中' : '同步上游支持的模型' }}
            </n-button>
            <n-button type="primary" attr-type="button" :disabled="loadingModels || savingModels || syncingModels" @click="saveAccountModels">
              {{ savingModels ? '保存中' : '保存模型' }}
            </n-button>
            <n-button secondary attr-type="button" :disabled="loadingModels || savingModels || syncingModels" @click="closeModelDrawer">取消</n-button>
          </div>
        </div>
      </n-drawer-content>
    </n-drawer>

    <n-modal
      v-model:show="syncModelModalVisible"
      preset="card"
      title="选择上游模型"
      style="width: min(760px, calc(100vw - 32px))"
    >
      <div class="sync-model-panel">
        <div class="panel-header">
          <n-checkbox
            :checked="allSyncModelsSelected"
            :indeterminate="selectedSyncModels.length > 0 && !allSyncModelsSelected"
            @update:checked="toggleAllSyncModels"
          >
            全选
          </n-checkbox>
        </div>
        <div v-if="syncModelOptions.length > 0" class="sync-model-list">
          <label v-for="model in syncModelOptions" :key="model" class="check-row option-item">
            <n-checkbox :checked="isSyncModelSelected(model)" @update:checked="(checked) => toggleSyncModel(model, checked)">
              <span class="mono">{{ model }}</span>
            </n-checkbox>
          </label>
        </div>
        <div v-else class="model-empty">未获取到上游模型。</div>
      </div>
      <template #footer>
        <div class="form-actions">
          <n-button secondary attr-type="button" @click="syncModelModalVisible = false">取消</n-button>
          <n-button type="primary" attr-type="button" @click="confirmSyncModels">确定</n-button>
        </div>
      </template>
    </n-modal>

    <n-modal
      preset="card"
      :show="!!pendingExpiredStatusAction"
      title="确认状态切换"
      style="width: min(420px, calc(100vw - 32px))"
      :mask-closable="updatingStatusAccountId === null"
      @update:show="(value) => { if (!value) closeExpiredStatusModal(); }"
    >
      <p class="muted status-confirm-copy">{{ expiredStatusConfirmText() }}</p>
      <template #footer>
        <div class="form-actions">
          <n-button secondary attr-type="button" :disabled="updatingStatusAccountId !== null" @click="closeExpiredStatusModal">取消</n-button>
          <n-button type="primary" attr-type="button" :disabled="updatingStatusAccountId !== null" @click="confirmExpiredStatusAction">
            {{ updatingStatusAccountId === pendingExpiredStatusAction?.account.id ? '处理中' : '确认' }}
          </n-button>
        </div>
      </template>
    </n-modal>

    <n-card class="admin-card" :bordered="false">
      <div class="panel-header">
        <h2>上游账号列表</h2>
        <div class="actions">
          <n-button type="primary" attr-type="button" @click="openCreateAccount">新增上游账号</n-button>
          <n-button secondary attr-type="button" :disabled="refreshingAllBalances" @click="refreshAllBalances">
            {{ refreshingAllBalances ? '刷新中' : '刷新全部余额' }}
          </n-button>
          <n-button secondary attr-type="button" @click="loadAll">刷新</n-button>
        </div>
      </div>
      <div class="toolbar">
        <n-button secondary attr-type="button" :disabled="selectedAccountIds.length === 0 || saving" @click="batchUpdateAccounts('enable')">批量启用</n-button>
        <n-button secondary attr-type="button" :disabled="selectedAccountIds.length === 0 || saving" @click="batchUpdateAccounts('disable')">批量停用</n-button>
        <n-button secondary attr-type="button" :disabled="selectedAccountIds.length === 0 || saving" @click="batchUpdateAccounts('refreshBalance')">批量刷新余额</n-button>
        <n-button secondary attr-type="button" :disabled="selectedAccountIds.length === 0 || saving" @click="batchUpdateAccounts('delete')">批量删除</n-button>
        <span class="muted">已选 {{ selectedAccountIds.length }}</span>
      </div>
      <div class="table-wrap">
        <n-table size="small" :bordered="false" single-line class="admin-table">
          <thead>
            <tr>
              <th>
                <n-checkbox :checked="allVisibleAccountsSelected()" :disabled="accounts.length === 0" @update:checked="toggleAllVisibleAccounts" />
              </th>
              <th>上游账号</th>
              <th>平台</th>
              <th>模式</th>
              <th>状态</th>
              <th>余额</th>
              <th>单位成本</th>
              <th>排序</th>
              <th>置顶</th>
              <th>最近刷新</th>
              <th>代理</th>
              <th>API Key</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="account in accounts" :key="account.id" :class="{ selected: isAccountSelected(account.id) }">
              <td>
                <n-checkbox :checked="isAccountSelected(account.id)" @update:checked="toggleAccountSelection(account.id)" />
              </td>
              <td>{{ accountLabel(account) }}</td>
              <td>{{ account.platform || '-' }}</td>
              <td>{{ account.credentialMode }}</td>
              <td>
                <n-dropdown
                  v-if="account.status === 'expired'"
                  trigger="click"
                  :options="expiredStatusActionOptions"
                  @select="(key) => selectExpiredStatusAction(account, key)"
                >
                  <button class="status-tag-button" type="button" :disabled="statusActionDisabled()">
                    <n-tag size="small" :type="accountStatusTagType(account.status)">
                      {{ accountStatusLabel(account.status) }}
                    </n-tag>
                  </button>
                </n-dropdown>
                <n-popconfirm
                  v-else-if="toggleStatusTarget(account.status)"
                  positive-text="确认"
                  negative-text="取消"
                  :disabled="statusActionDisabled()"
                  @positive-click="() => toggleAccountStatus(account)"
                >
                  <template #trigger>
                    <button class="status-tag-button" type="button" :disabled="statusActionDisabled()">
                      <n-tag size="small" :type="accountStatusTagType(account.status)">
                        {{ accountStatusLabel(account.status) }}
                      </n-tag>
                    </button>
                  </template>
                  {{ statusToggleConfirmText(account.status) }}
                </n-popconfirm>
                <n-tag v-else size="small" :type="accountStatusTagType(account.status)">
                  {{ accountStatusLabel(account.status) }}
                </n-tag>
              </td>
              <td class="mono">{{ formatNumber(account.balance) }} / {{ formatNumber(account.quota) }}</td>
              <td class="mono">{{ account.unitCost ?? '-' }}</td>
              <td>{{ account.sortOrder }}</td>
              <td>{{ account.isPinned ? '是' : '否' }}</td>
              <td>{{ formatTime(account.lastBalanceRefresh) }}</td>
              <td class="mono">{{ account.proxyUrl || '-' }}</td>
              <td class="mono">{{ account.apiKeyMasked || '-' }}</td>
              <td class="actions">
                <n-button text attr-type="button" :disabled="refreshingBalanceId === account.id" @click="refreshBalance(account)">
                  {{ refreshingBalanceId === account.id ? '刷新中' : '刷新余额' }}
                </n-button>
                <n-button text attr-type="button" @click="openModelDrawer(account)">{{ modelActionLabel(account) }}</n-button>
                <n-button text attr-type="button" @click="editAccount(account)">编辑</n-button>
                <n-button type="error" text attr-type="button" @click="removeAccount(account)">删除</n-button>
              </td>
            </tr>
            <tr v-if="!loading && accounts.length === 0">
              <td class="empty" colspan="13">暂无上游账号</td>
            </tr>
          </tbody>
        </n-table>
      </div>
    </n-card>
  </section>
</template>

<style scoped lang="scss">
.model-drawer-stack {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.model-drawer-section {
  display: flex;
  flex-direction: column;
  gap: 14px;
  border: 1px solid #e0e7ef;
  border-radius: 8px;
  background: #f8fafc;
  padding: 14px;
}

.model-chip-grid {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.model-chip-item {
  display: flex;
  min-width: 0;
  min-height: 38px;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: #ffffff;
  padding: 0 10px 0 12px;
}

.model-chip-name {
  min-width: 0;
  overflow: hidden;
  color: #243348;
  font-family: "Fira Code", "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  font-size: 12px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-chip-remove {
  display: flex;
  width: 24px;
  height: 24px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #64748b;
  font-size: 18px;
  line-height: 1;
}

.model-chip-remove:hover {
  background: #fee2e2;
  color: #b91c1c;
}

.model-input-row {
  display: flex;
  gap: 10px;
}

.preset-models {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.model-empty {
  border: 1px dashed #cbd5e1;
  border-radius: 8px;
  color: #64748b;
  padding: 18px;
  text-align: center;
}

.model-empty.compact {
  padding: 12px;
}

.model-drawer-footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 10px;
  border-top: 1px solid #e0e7ef;
  padding-top: 14px;
}

.status-confirm-copy {
  margin-top: 0;
}

.status-tag-button {
  display: inline-flex;
  border: 0;
  background: transparent;
  padding: 0;
  cursor: pointer;
}

.status-tag-button:disabled {
  cursor: not-allowed;
}

.sync-model-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.sync-model-list {
  display: grid;
  max-height: min(520px, 60vh);
  gap: 8px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  overflow: auto;
  padding-right: 4px;
}

@media (max-width: 700px) {
  .model-chip-grid,
  .model-input-row,
  .sync-model-list {
    grid-template-columns: 1fr;
  }

  .model-input-row {
    flex-direction: column;
  }
}
</style>
