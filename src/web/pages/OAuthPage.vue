<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, type OAuthConnectionInfo, type OAuthConnectionsResponse, type OAuthProviderInfo, type OAuthProvidersResponse, type OAuthSessionInfo } from '@web/api';

const data = ref<OAuthProvidersResponse | null>(null);
const connections = ref<OAuthConnectionsResponse | null>(null);
const session = ref<OAuthSessionInfo | null>(null);
const loading = ref(false);
const connectionsLoading = ref(false);
const mutatingConnectionId = ref<number | null>(null);
const error = ref('');
const connectionsError = ref('');
const message = ref('');
const callbackUrl = ref('');
const importPayload = ref('');

const providers = computed(() => data.value?.providers || []);
const connectionItems = computed(() => connections.value?.items || []);
const systemProxyStatus = computed(() => data.value?.defaults.systemProxyConfigured ? '已配置' : '未配置');

async function loadProviders() {
  loading.value = true;
  error.value = '';
  try {
    data.value = await api.getOAuthProviders();
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加载 OAuth provider 失败';
  } finally {
    loading.value = false;
  }
}

async function loadConnections() {
  connectionsLoading.value = true;
  connectionsError.value = '';
  try {
    connections.value = await api.getOAuthConnections();
  } catch (err) {
    connectionsError.value = err instanceof Error ? err.message : '加载 OAuth 连接失败';
  } finally {
    connectionsLoading.value = false;
  }
}

function formatConnectionIdentity(connection: { email: string | null; username: string | null; accountKey: string | null }) {
  return connection.email || connection.username || connection.accountKey || '未命名连接';
}

async function startProvider(provider: OAuthProviderInfo) {
  loading.value = true;
  error.value = '';
  message.value = '';
  try {
    session.value = await api.startOAuthSession(provider.provider);
    message.value = 'OAuth session 已创建，可复制授权地址或粘贴 callback URL';
  } catch (err) {
    error.value = err instanceof Error ? err.message : '发起 OAuth 失败';
  } finally {
    loading.value = false;
  }
}

async function completeSession() {
  if (!session.value) return;
  loading.value = true;
  error.value = '';
  message.value = '';
  try {
    session.value = await api.completeOAuthSession(session.value.state, callbackUrl.value.trim());
    message.value = session.value.message || 'OAuth callback 已处理';
    await loadConnections();
  } catch (err) {
    error.value = err instanceof Error ? err.message : '处理 OAuth callback 失败';
  } finally {
    loading.value = false;
  }
}

async function importCredentials() {
  loading.value = true;
  error.value = '';
  message.value = '';
  try {
    const payload = JSON.parse(importPayload.value || '{}') as unknown;
    const result = await api.importOAuthCredentials(payload);
    message.value = `已导入 ${result.imported} 个 OAuth 账号`;
    importPayload.value = '';
    await loadConnections();
  } catch (err) {
    error.value = err instanceof Error ? err.message : '导入 OAuth 凭证失败';
  } finally {
    loading.value = false;
  }
}

async function toggleConnection(connection: OAuthConnectionInfo) {
  mutatingConnectionId.value = connection.accountId;
  connectionsError.value = '';
  message.value = '';
  try {
    await api.updateOAuthConnection(connection.accountId, { enabled: !connection.enabled });
    message.value = `OAuth 连接已${connection.enabled ? '停用' : '启用'}`;
    await loadConnections();
  } catch (err) {
    connectionsError.value = err instanceof Error ? err.message : '更新 OAuth 连接失败';
  } finally {
    mutatingConnectionId.value = null;
  }
}

async function removeConnection(connection: OAuthConnectionInfo) {
  const name = formatConnectionIdentity(connection);
  if (!window.confirm(`删除 OAuth 连接 ${name}？`)) return;
  mutatingConnectionId.value = connection.accountId;
  connectionsError.value = '';
  message.value = '';
  try {
    await api.deleteOAuthConnection(connection.accountId);
    message.value = 'OAuth 连接已删除';
    await loadConnections();
  } catch (err) {
    connectionsError.value = err instanceof Error ? err.message : '删除 OAuth 连接失败';
  } finally {
    mutatingConnectionId.value = null;
  }
}

async function refreshConnection(connection: OAuthConnectionInfo) {
  mutatingConnectionId.value = connection.accountId;
  connectionsError.value = '';
  message.value = '';
  try {
    await api.refreshOAuthConnection(connection.accountId);
    message.value = 'OAuth 连接已刷新';
    await loadConnections();
  } catch (err) {
    connectionsError.value = err instanceof Error ? err.message : '刷新 OAuth 连接失败';
  } finally {
    mutatingConnectionId.value = null;
  }
}

async function refreshQuota(connection: OAuthConnectionInfo) {
  mutatingConnectionId.value = connection.accountId;
  connectionsError.value = '';
  message.value = '';
  try {
    await api.refreshOAuthQuota(connection.accountId);
    message.value = 'OAuth quota 已刷新';
    await loadConnections();
  } catch (err) {
    connectionsError.value = err instanceof Error ? err.message : '刷新 OAuth quota 失败';
  } finally {
    mutatingConnectionId.value = null;
  }
}

onMounted(async () => {
  await Promise.all([loadProviders(), loadConnections()]);
});
</script>

<template>
  <section class="page-stack">
    <div class="panel">
      <div class="panel-header">
        <div>
          <h2>OAuth Provider</h2>
          <p class="muted">当前支持 provider 元数据、本地 session 和手动 callback 初版。</p>
        </div>
        <button class="btn btn-secondary" type="button" :disabled="loading" @click="loadProviders">
          {{ loading ? '刷新中' : '刷新' }}
        </button>
      </div>

      <p class="muted">系统代理：{{ systemProxyStatus }}</p>
      <p v-if="error" class="error">{{ error }}</p>
      <div v-if="loading" class="empty">加载中</div>
      <div v-else class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Provider</th>
              <th>平台</th>
              <th>状态</th>
              <th>项目 ID</th>
              <th>能力</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="provider in providers" :key="provider.provider">
              <td>
                <strong>{{ provider.label }}</strong>
                <p class="muted mono">{{ provider.provider }}</p>
              </td>
              <td>{{ provider.platform }}</td>
              <td>{{ provider.enabled ? '可发现' : '停用' }}</td>
              <td>{{ provider.requiresProjectId ? '需要' : '不需要' }}</td>
              <td>
                <div class="model-list">
                  <span v-if="provider.supportsDirectAccountRouting" class="badge">直接路由</span>
                  <span v-if="provider.supportsCloudValidation" class="badge">云端校验</span>
                  <span v-if="provider.supportsNativeProxy" class="badge">原生代理</span>
                </div>
              </td>
              <td>
                <button class="text-btn" type="button" :disabled="loading" @click="startProvider(provider)">发起</button>
              </td>
            </tr>
            <tr v-if="providers.length === 0">
              <td colspan="6" class="empty">暂无 Provider</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header">
        <div>
          <h2>授权会话</h2>
          <p class="muted">当前支持本地 session、manual callback 和 JSON 凭证导入。</p>
        </div>
      </div>
      <div v-if="session" class="page-stack">
        <p class="muted">State：<span class="mono">{{ session.state }}</span>，状态：{{ session.status }}</p>
        <p class="muted">授权地址：<span class="mono">{{ session.authorizationUrl }}</span></p>
        <label class="field">
          <span>Callback URL</span>
          <textarea v-model="callbackUrl" class="textarea" rows="3" placeholder="粘贴包含 access_token/token/api_key 的 callback URL"></textarea>
        </label>
        <button class="btn btn-secondary" type="button" :disabled="loading || !callbackUrl.trim()" @click="completeSession">提交 Callback</button>
      </div>
      <label class="field">
        <span>导入 OAuth JSON</span>
        <textarea v-model="importPayload" class="textarea" rows="4" placeholder='{"provider":"codex","accessToken":"..."}'></textarea>
      </label>
      <button class="btn btn-secondary" type="button" :disabled="loading || !importPayload.trim()" @click="importCredentials">导入凭证</button>
    </div>

    <div class="panel">
      <div class="panel-header">
        <div>
          <h2>OAuth 连接</h2>
          <p class="muted">当前读取账号表中的 OAuth 连接，支持本地刷新、quota 和删除。</p>
        </div>
        <button class="btn btn-secondary" type="button" :disabled="connectionsLoading" @click="loadConnections">
          {{ connectionsLoading ? '刷新中' : '刷新' }}
        </button>
      </div>

      <p v-if="connectionsError" class="error">{{ connectionsError }}</p>
      <p v-if="message" class="notice">{{ message }}</p>
      <div v-if="connectionsLoading" class="empty">加载中</div>
      <div v-else class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>账号</th>
              <th>Provider</th>
              <th>站点</th>
              <th>状态</th>
              <th>模型</th>
              <th>通道</th>
              <th>项目</th>
              <th>代理</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="connection in connectionItems" :key="connection.accountId">
              <td>
                <strong>{{ formatConnectionIdentity(connection) }}</strong>
                <p class="muted mono">#{{ connection.accountId }}</p>
              </td>
              <td>{{ connection.provider }}</td>
              <td>
                <span>{{ connection.site?.name || '-' }}</span>
                <p v-if="connection.site" class="muted mono">{{ connection.site.platform }}</p>
              </td>
              <td>
                <span class="badge" :class="connection.status === 'healthy' ? 'success' : 'failed'">
                  {{ connection.status === 'healthy' ? '正常' : '异常' }}
                </span>
                <p class="muted mono">{{ connection.accountStatus }}</p>
              </td>
              <td>
                <span>{{ connection.modelCount }}</span>
                <p v-if="connection.lastModelSyncAt" class="muted mono">{{ connection.lastModelSyncAt }}</p>
                <div v-if="connection.modelsPreview.length > 0" class="model-list">
                  <span v-for="model in connection.modelsPreview" :key="model" class="chip">{{ model }}</span>
                </div>
              </td>
              <td>{{ connection.routeChannelCount }}</td>
              <td class="mono">{{ connection.projectId || '-' }}</td>
              <td class="mono">{{ connection.proxyUrl || '-' }}</td>
              <td class="actions">
                <button
                  class="text-btn"
                  type="button"
                  :disabled="mutatingConnectionId === connection.accountId"
                  @click="toggleConnection(connection)"
                >
                  {{ connection.enabled ? '停用' : '启用' }}
                </button>
                <button
                  class="text-btn"
                  type="button"
                  :disabled="mutatingConnectionId === connection.accountId"
                  @click="refreshConnection(connection)"
                >
                  刷新
                </button>
                <button
                  class="text-btn"
                  type="button"
                  :disabled="mutatingConnectionId === connection.accountId"
                  @click="refreshQuota(connection)"
                >
                  Quota
                </button>
                <button
                  class="text-btn danger"
                  type="button"
                  :disabled="mutatingConnectionId === connection.accountId"
                  @click="removeConnection(connection)"
                >
                  删除
                </button>
              </td>
            </tr>
            <tr v-if="connectionItems.length === 0">
              <td colspan="9" class="empty">暂无 OAuth 连接</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>
