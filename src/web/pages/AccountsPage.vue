<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { api, type Account, type AccountBatchAction, type AccountToken, type Site } from '@web/api';

const sites = ref<Site[]>([]);
const accounts = ref<Account[]>([]);
const tokens = ref<AccountToken[]>([]);
const loading = ref(false);
const saving = ref(false);
const refreshingBalanceId = ref<number | null>(null);
const refreshingAllBalances = ref(false);
const syncingTokenAccountId = ref<number | null>(null);
const editingAccountId = ref<number | null>(null);
const editingTokenId = ref<number | null>(null);
const selectedAccountIds = ref<number[]>([]);
const selectedTokenIds = ref<number[]>([]);
const error = ref('');
const message = ref('');
const accountForm = reactive({
  siteId: 0,
  username: '',
  credentialMode: 'apikey',
  apiToken: '',
  unitCost: '',
  proxyUrl: '',
  status: 'active',
  isPinned: false,
  sortOrder: 0
});
const tokenForm = reactive({
  accountId: 0,
  name: '',
  token: '',
  tokenGroup: '',
  enabled: true,
  isDefault: false
});
const tokenFilters = reactive({
  accountId: 0,
  enabled: 'all',
  tokenGroup: ''
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

function toggleAllVisibleAccounts(event: Event) {
  const checked = (event.target as HTMLInputElement).checked;
  const visibleIds = accounts.value.map((account) => account.id);
  if (checked) {
    selectedAccountIds.value = Array.from(new Set([...selectedAccountIds.value, ...visibleIds]));
  } else {
    selectedAccountIds.value = selectedAccountIds.value.filter((id) => !visibleIds.includes(id));
  }
}

function resetAccountForm() {
  editingAccountId.value = null;
  accountForm.siteId = sites.value[0]?.id || 0;
  accountForm.username = '';
  accountForm.credentialMode = 'apikey';
  accountForm.apiToken = '';
  accountForm.unitCost = '';
  accountForm.proxyUrl = '';
  accountForm.status = 'active';
  accountForm.isPinned = false;
  accountForm.sortOrder = accounts.value.length;
}

function editAccount(account: Account) {
  editingAccountId.value = account.id;
  error.value = '';
  message.value = '';
  accountForm.siteId = account.siteId;
  accountForm.username = account.username || '';
  accountForm.credentialMode = account.credentialMode;
  accountForm.apiToken = '';
  accountForm.unitCost = account.unitCost === null ? '' : String(account.unitCost);
  accountForm.proxyUrl = account.proxyUrl || '';
  accountForm.status = account.status;
  accountForm.isPinned = account.isPinned;
  accountForm.sortOrder = account.sortOrder;
}

function resetTokenForm() {
  editingTokenId.value = null;
  tokenForm.accountId = accounts.value[0]?.id || 0;
  tokenForm.name = '';
  tokenForm.token = '';
  tokenForm.tokenGroup = '';
  tokenForm.enabled = true;
  tokenForm.isDefault = false;
}

function tokenListQuery() {
  const query: Record<string, string | number | boolean> = {};
  if (tokenFilters.accountId) query.accountId = tokenFilters.accountId;
  if (tokenFilters.enabled !== 'all') query.enabled = tokenFilters.enabled === 'true';
  if (tokenFilters.tokenGroup.trim()) query.tokenGroup = tokenFilters.tokenGroup.trim();
  return query;
}

function setTokenRows(items: AccountToken[]) {
  tokens.value = items;
  selectedTokenIds.value = selectedTokenIds.value.filter((id) => items.some((token) => token.id === id));
}

async function loadTokens() {
  loading.value = true;
  error.value = '';
  try {
    const tokenData = await api.listTokens(tokenListQuery());
    setTokenRows(tokenData.items);
  } catch (err) {
    setError(err, '加载 Token 失败');
  } finally {
    loading.value = false;
  }
}

function editToken(token: AccountToken) {
  editingTokenId.value = token.id;
  error.value = '';
  message.value = '';
  tokenForm.accountId = token.accountId;
  tokenForm.name = token.name;
  tokenForm.token = '';
  tokenForm.tokenGroup = token.tokenGroup || '';
  tokenForm.enabled = token.enabled;
  tokenForm.isDefault = token.isDefault;
}

async function loadAll() {
  loading.value = true;
  error.value = '';
  try {
    const [siteData, accountData, tokenData] = await Promise.all([
      api.listSites(),
      api.listAccounts(),
      api.listTokens(tokenListQuery())
    ]);
    sites.value = siteData.items;
    accounts.value = accountData.items;
    selectedAccountIds.value = selectedAccountIds.value.filter((id) => accounts.value.some((account) => account.id === id));
    setTokenRows(tokenData.items);
    if (!accountForm.siteId) resetAccountForm();
    if (!tokenForm.accountId) resetTokenForm();
  } catch (err) {
    setError(err, '加载连接失败');
  } finally {
    loading.value = false;
  }
}

async function createAccount() {
  saving.value = true;
  error.value = '';
  message.value = '';
  try {
    const payload: Record<string, unknown> = {
      siteId: Number(accountForm.siteId),
      username: accountForm.username.trim() || null,
      credentialMode: accountForm.credentialMode,
      unitCost: accountForm.unitCost ? Number(accountForm.unitCost) : null,
      proxyUrl: accountForm.proxyUrl.trim() || null,
      status: accountForm.status,
      isPinned: accountForm.isPinned,
      sortOrder: Number(accountForm.sortOrder) || 0
    };
    const apiToken = accountForm.apiToken.trim();
    if (editingAccountId.value) {
      if (apiToken) payload.apiToken = apiToken;
      await api.updateAccount(editingAccountId.value, payload);
      message.value = '账号已更新';
    } else {
      payload.apiToken = apiToken || null;
      await api.createAccount(payload);
      message.value = '账号已创建';
    }
    resetAccountForm();
    await loadAll();
  } catch (err) {
    setError(err, '创建账号失败');
  } finally {
    saving.value = false;
  }
}

async function saveToken() {
  saving.value = true;
  error.value = '';
  message.value = '';
  try {
    const tokenValue = tokenForm.token.trim();
    const payload: Record<string, unknown> = {
      name: tokenForm.name.trim(),
      tokenGroup: tokenForm.tokenGroup.trim() || null,
      enabled: tokenForm.enabled,
      isDefault: tokenForm.isDefault
    };
    // 编辑时 Token 留空表示保留原值，避免误覆盖已保存密钥。
    if (editingTokenId.value) {
      if (tokenValue) payload.token = tokenValue;
      await api.updateToken(editingTokenId.value, payload);
      message.value = '账号 Token 已更新';
    } else {
      payload.accountId = Number(tokenForm.accountId);
      payload.token = tokenValue;
      await api.createToken(payload);
      message.value = '账号 Token 已创建';
    }
    resetTokenForm();
    await loadAll();
  } catch (err) {
    setError(err, '保存 Token 失败');
  } finally {
    saving.value = false;
  }
}

async function refreshModels(account: Account) {
  error.value = '';
  message.value = '';
  try {
    const result = await api.refreshModels(account.id);
    message.value = `模型刷新完成：新增 ${result.created}，更新 ${result.updated}`;
  } catch (err) {
    setError(err, '刷新模型失败');
  }
}

async function syncTokens(account: Account) {
  syncingTokenAccountId.value = account.id;
  error.value = '';
  message.value = '';
  try {
    const result = await api.syncAccountTokens(account.id);
    const preservedFields = result.preservedLocalFields.join(', ');
    message.value = `Token 同步完成：新增 ${result.created}，更新 ${result.updated}，待补全 ${result.maskedPending}，保留 ${preservedFields}`;
    await loadAll();
  } catch (err) {
    setError(err, '同步 Token 失败');
  } finally {
    syncingTokenAccountId.value = null;
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

async function removeAccount(account: Account) {
  if (!window.confirm(`删除账号 ${account.username || account.id}？`)) return;
  error.value = '';
  try {
    await api.deleteAccount(account.id);
    await loadAll();
  } catch (err) {
    setError(err, '删除账号失败');
  }
}

async function batchUpdateAccounts(action: AccountBatchAction) {
  const ids = selectedAccountIds.value.slice();
  if (ids.length === 0) return;
  if (!window.confirm(`批量${batchAccountActionLabel(action)} ${ids.length} 个账号？`)) return;
  saving.value = true;
  error.value = '';
  message.value = '';
  try {
    const result = await api.batchUpdateAccounts(ids, action);
    selectedAccountIds.value = [];
    message.value = `批量${batchAccountActionLabel(action)}完成：成功 ${result.successIds.length}，失败 ${result.failedItems.length}`;
    await loadAll();
  } catch (err) {
    setError(err, '批量更新账号失败');
  } finally {
    saving.value = false;
  }
}

async function toggleToken(token: AccountToken) {
  error.value = '';
  try {
    await api.updateToken(token.id, { enabled: !token.enabled });
    await loadAll();
  } catch (err) {
    setError(err, '更新 Token 失败');
  }
}

function isTokenSelected(id: number) {
  return selectedTokenIds.value.includes(id);
}

function toggleTokenSelection(id: number) {
  selectedTokenIds.value = isTokenSelected(id)
    ? selectedTokenIds.value.filter((item) => item !== id)
    : [...selectedTokenIds.value, id];
}

function allVisibleTokensSelected() {
  return tokens.value.length > 0 && tokens.value.every((token) => selectedTokenIds.value.includes(token.id));
}

function toggleAllVisibleTokens(event: Event) {
  const checked = (event.target as HTMLInputElement).checked;
  const visibleIds = tokens.value.map((token) => token.id);
  if (checked) {
    selectedTokenIds.value = Array.from(new Set([...selectedTokenIds.value, ...visibleIds]));
  } else {
    selectedTokenIds.value = selectedTokenIds.value.filter((id) => !visibleIds.includes(id));
  }
}

async function batchSetTokensEnabled(enabled: boolean) {
  const ids = selectedTokenIds.value.slice();
  if (ids.length === 0) return;
  saving.value = true;
  error.value = '';
  message.value = '';
  try {
    const result = await api.batchSetTokensEnabled(ids, enabled);
    message.value = `已批量${enabled ? '启用' : '停用'} ${result.updated} 个 Token`;
    selectedTokenIds.value = [];
    await loadTokens();
  } catch (err) {
    setError(err, '批量更新 Token 失败');
  } finally {
    saving.value = false;
  }
}

async function setDefaultToken(token: AccountToken) {
  error.value = '';
  try {
    await api.updateToken(token.id, { isDefault: true });
    await loadAll();
  } catch (err) {
    setError(err, '设置默认 Token 失败');
  }
}

async function removeToken(token: AccountToken) {
  if (!window.confirm(`删除 Token ${token.name}？`)) return;
  error.value = '';
  try {
    await api.deleteToken(token.id);
    await loadAll();
  } catch (err) {
    setError(err, '删除 Token 失败');
  }
}

onMounted(loadAll);
</script>

<template>
  <section class="page-stack">
    <div class="two-column">
      <div class="panel">
        <div class="panel-header">
          <div>
            <h2>{{ editingAccountId ? '编辑上游账号' : '上游账号' }}</h2>
            <p class="muted">绑定站点 API 凭据。</p>
          </div>
        </div>
        <form class="form-grid single" @submit.prevent="createAccount">
          <label class="field">
            <span>站点</span>
            <select v-model.number="accountForm.siteId" class="select" required>
              <option v-for="site in sites" :key="site.id" :value="site.id">{{ site.name }}</option>
            </select>
          </label>
          <label class="field">
            <span>用户名</span>
            <input v-model="accountForm.username" class="input" placeholder="可选" />
          </label>
          <label class="field">
            <span>凭据模式</span>
            <select v-model="accountForm.credentialMode" class="select">
              <option value="apikey">API Key</option>
              <option value="session">Session</option>
              <option value="oauth">OAuth</option>
              <option value="auto">Auto</option>
            </select>
          </label>
          <label class="field">
            <span>API Token</span>
            <input v-model="accountForm.apiToken" class="input" type="password" :placeholder="editingAccountId ? '留空则不修改' : ''" />
          </label>
          <label class="field">
            <span>单位成本</span>
            <input v-model="accountForm.unitCost" class="input" min="0" step="0.0001" type="number" placeholder="每 100 万 token" />
          </label>
          <label class="field">
            <span>账号代理</span>
            <input v-model="accountForm.proxyUrl" class="input" placeholder="http://127.0.0.1:7890" />
          </label>
          <label class="field">
            <span>状态</span>
            <select v-model="accountForm.status" class="select">
              <option value="active">启用</option>
              <option value="disabled">停用</option>
              <option value="expired">过期</option>
            </select>
          </label>
          <label class="field">
            <span>排序</span>
            <input v-model.number="accountForm.sortOrder" class="input" min="0" step="1" type="number" />
          </label>
          <label class="check-row">
            <input v-model="accountForm.isPinned" type="checkbox" />
            <span>置顶账号</span>
          </label>
          <div class="form-actions">
            <button class="btn btn-primary" type="submit" :disabled="saving || sites.length === 0">
              {{ saving ? '保存中' : editingAccountId ? '保存修改' : '创建账号' }}
            </button>
            <button v-if="editingAccountId" class="btn btn-secondary" type="button" @click="resetAccountForm">取消编辑</button>
          </div>
        </form>
      </div>

      <div class="panel">
        <div class="panel-header">
          <div>
            <h2>{{ editingTokenId ? '编辑账号 Token' : '账号 Token' }}</h2>
            <p class="muted">为账号添加可路由 Token。</p>
          </div>
        </div>
        <form class="form-grid single" @submit.prevent="saveToken">
          <label class="field">
            <span>账号</span>
            <select v-model.number="tokenForm.accountId" class="select" :disabled="!!editingTokenId" required>
              <option v-for="account in accounts" :key="account.id" :value="account.id">
                {{ account.siteName || account.siteId }} / {{ account.username || account.id }}
              </option>
            </select>
          </label>
          <label class="field">
            <span>名称</span>
            <input v-model="tokenForm.name" class="input" required />
          </label>
          <label class="field">
            <span>Token</span>
            <input v-model="tokenForm.token" class="input" :required="!editingTokenId" type="password" :placeholder="editingTokenId ? '留空则不修改' : ''" />
          </label>
          <label class="field">
            <span>分组</span>
            <input v-model="tokenForm.tokenGroup" class="input" placeholder="可选" />
          </label>
          <label class="check-row">
            <input v-model="tokenForm.enabled" type="checkbox" />
            <span>启用</span>
          </label>
          <label class="check-row">
            <input v-model="tokenForm.isDefault" type="checkbox" />
            <span>默认 Token</span>
          </label>
          <div class="form-actions">
            <button class="btn btn-primary" type="submit" :disabled="saving || accounts.length === 0">
              {{ saving ? '保存中' : editingTokenId ? '保存修改' : '创建 Token' }}
            </button>
            <button v-if="editingTokenId" class="btn btn-secondary" type="button" @click="resetTokenForm">取消编辑</button>
          </div>
        </form>
      </div>
    </div>

    <p v-if="message" class="notice">{{ message }}</p>
    <p v-if="error" class="error">{{ error }}</p>

    <div class="panel">
      <div class="panel-header">
        <h2>账号列表</h2>
        <div class="actions">
          <button class="btn btn-secondary" type="button" :disabled="refreshingAllBalances" @click="refreshAllBalances">
            {{ refreshingAllBalances ? '刷新中' : '刷新全部余额' }}
          </button>
          <button class="btn btn-secondary" type="button" @click="loadAll">刷新</button>
        </div>
      </div>
      <div class="toolbar">
        <button class="btn btn-secondary" type="button" :disabled="selectedAccountIds.length === 0 || saving" @click="batchUpdateAccounts('enable')">批量启用</button>
        <button class="btn btn-secondary" type="button" :disabled="selectedAccountIds.length === 0 || saving" @click="batchUpdateAccounts('disable')">批量停用</button>
        <button class="btn btn-secondary" type="button" :disabled="selectedAccountIds.length === 0 || saving" @click="batchUpdateAccounts('refreshBalance')">批量刷新余额</button>
        <button class="btn btn-secondary" type="button" :disabled="selectedAccountIds.length === 0 || saving" @click="batchUpdateAccounts('delete')">批量删除</button>
        <span class="muted">已选 {{ selectedAccountIds.length }}</span>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>
                <input type="checkbox" :checked="allVisibleAccountsSelected()" :disabled="accounts.length === 0" @change="toggleAllVisibleAccounts" />
              </th>
              <th>站点</th>
              <th>用户</th>
              <th>模式</th>
              <th>状态</th>
              <th>余额</th>
              <th>单位成本</th>
              <th>排序</th>
              <th>置顶</th>
              <th>最近刷新</th>
              <th>代理</th>
              <th>Token</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="account in accounts" :key="account.id" :class="{ selected: isAccountSelected(account.id) }">
              <td>
                <input type="checkbox" :checked="isAccountSelected(account.id)" @change="toggleAccountSelection(account.id)" />
              </td>
              <td>{{ account.siteName || account.siteId }}</td>
              <td>{{ account.username || '-' }}</td>
              <td>{{ account.credentialMode }}</td>
              <td><span class="badge" :class="account.status">{{ account.status }}</span></td>
              <td class="mono">{{ formatNumber(account.balance) }} / {{ formatNumber(account.quota) }}</td>
              <td class="mono">{{ account.unitCost ?? '-' }}</td>
              <td>{{ account.sortOrder }}</td>
              <td>{{ account.isPinned ? '是' : '否' }}</td>
              <td>{{ formatTime(account.lastBalanceRefresh) }}</td>
              <td class="mono">{{ account.proxyUrl || '-' }}</td>
              <td class="mono">{{ account.apiTokenMasked }}</td>
              <td class="actions">
                <button class="text-btn" type="button" :disabled="refreshingBalanceId === account.id" @click="refreshBalance(account)">
                  {{ refreshingBalanceId === account.id ? '刷新中' : '刷新余额' }}
                </button>
                <button class="text-btn" type="button" @click="refreshModels(account)">刷新模型</button>
                <button class="text-btn" type="button" :disabled="syncingTokenAccountId === account.id" @click="syncTokens(account)">
                  {{ syncingTokenAccountId === account.id ? '同步中' : '同步 Token' }}
                </button>
                <button class="text-btn" type="button" @click="editAccount(account)">编辑</button>
                <button class="text-btn danger" type="button" @click="removeAccount(account)">删除</button>
              </td>
            </tr>
            <tr v-if="!loading && accounts.length === 0">
              <td class="empty" colspan="13">暂无账号</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header">
        <h2>Token 列表</h2>
      </div>
      <div class="toolbar">
        <select v-model.number="tokenFilters.accountId" class="select">
          <option :value="0">全部账号</option>
          <option v-for="account in accounts" :key="account.id" :value="account.id">
            {{ account.siteName || account.siteId }} / {{ account.username || account.id }}
          </option>
        </select>
        <select v-model="tokenFilters.enabled" class="select">
          <option value="all">全部状态</option>
          <option value="true">启用</option>
          <option value="false">停用</option>
        </select>
        <input v-model="tokenFilters.tokenGroup" class="input" placeholder="分组" />
        <button class="btn btn-secondary" type="button" @click="loadTokens">筛选</button>
        <button class="btn btn-secondary" type="button" :disabled="selectedTokenIds.length === 0 || saving" @click="batchSetTokensEnabled(true)">批量启用</button>
        <button class="btn btn-secondary" type="button" :disabled="selectedTokenIds.length === 0 || saving" @click="batchSetTokensEnabled(false)">批量停用</button>
        <span class="muted">已选 {{ selectedTokenIds.length }}</span>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>
                <input type="checkbox" :checked="allVisibleTokensSelected()" :disabled="tokens.length === 0" @change="toggleAllVisibleTokens" />
              </th>
              <th>名称</th>
              <th>账号</th>
              <th>分组</th>
              <th>状态</th>
              <th>默认</th>
              <th>Token</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="token in tokens" :key="token.id">
              <td>
                <input type="checkbox" :checked="isTokenSelected(token.id)" @change="toggleTokenSelection(token.id)" />
              </td>
              <td>{{ token.name }}</td>
              <td>{{ token.siteName || '-' }} / {{ token.accountName || token.accountId }}</td>
              <td>{{ token.tokenGroup || '-' }}</td>
              <td><span class="badge" :class="token.enabled ? 'active' : 'disabled'">{{ token.enabled ? '启用' : '停用' }}</span></td>
              <td>{{ token.isDefault ? '是' : '否' }}</td>
              <td class="mono">{{ token.tokenMasked }}</td>
              <td class="actions">
                <button class="text-btn" type="button" @click="editToken(token)">编辑</button>
                <button class="text-btn" type="button" @click="toggleToken(token)">
                  {{ token.enabled ? '停用' : '启用' }}
                </button>
                <button class="text-btn" type="button" :disabled="token.isDefault" @click="setDefaultToken(token)">设默认</button>
                <button class="text-btn danger" type="button" @click="removeToken(token)">删除</button>
              </td>
            </tr>
            <tr v-if="!loading && tokens.length === 0">
              <td class="empty" colspan="8">暂无 Token</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>
