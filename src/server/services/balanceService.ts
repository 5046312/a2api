import { eq } from 'drizzle-orm';
import { getAdapter, type SitePlatform } from '../adapters/index.js';
import type { BalanceInfo } from '../adapters/types.js';
import { db, schema } from '../db/index.js';
import { parseJsonObject } from '../shared/json.js';
import { nowIso } from '../shared/time.js';

type AccountBalanceRow = typeof schema.accounts.$inferSelect & {
  siteName: string;
  siteUrl: string;
  sitePlatform: string;
  siteStatus: string;
  siteProxyUrl: string | null;
  siteCustomHeaders: string | null;
};

export type BalanceRefreshResult = {
  accountId: number;
  balance: number;
  used: number;
  quota: number;
  refreshedAt: string | null;
  skipped: boolean;
  reason: string | null;
};

export type BalanceRefreshAllResult = {
  items: BalanceRefreshResult[];
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
};

export async function refreshAccountBalance(accountId: number): Promise<BalanceRefreshResult> {
  const account = await getAccountBalanceRow(accountId);
  if (!account) throw new Error('Account not found');

  const skipped = skippedAccountBalanceResult(account);
  if (skipped) return skipped;

  const adapter = getAdapter(account.sitePlatform);
  if (!adapter.getBalance) {
    return skippedAccountBalanceResult(account, 'balance_unsupported');
  }

  try {
    const balance = await adapter.getBalance({
      siteId: account.siteId,
      baseUrl: account.siteUrl,
      platform: account.sitePlatform as SitePlatform,
      accessToken: account.accessToken,
      apiToken: account.apiToken,
      proxyUrl: accountProxyUrl(account.extraConfig) || account.siteProxyUrl,
      customHeaders: parseJsonObject(account.siteCustomHeaders) as Record<string, string> | null
    });
    if (!balance) return skippedAccountBalanceResult(account, 'balance_unsupported');
    return await saveBalanceResult(account, balance);
  } catch (error) {
    await recordBalanceRefreshFailure(account, error);
    throw error;
  }
}

export async function refreshAllAccountBalances(): Promise<BalanceRefreshAllResult> {
  const rows = await db
    .select({ id: schema.accounts.id })
    .from(schema.accounts)
    .where(eq(schema.accounts.status, 'active'))
    .all();
  const items: BalanceRefreshResult[] = [];
  let failed = 0;

  for (const row of rows) {
    try {
      items.push(await refreshAccountBalance(row.id));
    } catch {
      failed += 1;
    }
  }

  const skipped = items.filter((item) => item.skipped).length;
  return {
    items,
    total: rows.length,
    succeeded: items.length - skipped,
    failed,
    skipped
  };
}

async function getAccountBalanceRow(accountId: number): Promise<AccountBalanceRow | null> {
  const row = await db
    .select({
      id: schema.accounts.id,
      siteId: schema.accounts.siteId,
      username: schema.accounts.username,
      credentialMode: schema.accounts.credentialMode,
      accessToken: schema.accounts.accessToken,
      apiToken: schema.accounts.apiToken,
      balance: schema.accounts.balance,
      balanceUsed: schema.accounts.balanceUsed,
      quota: schema.accounts.quota,
      unitCost: schema.accounts.unitCost,
      valueScore: schema.accounts.valueScore,
      status: schema.accounts.status,
      isPinned: schema.accounts.isPinned,
      sortOrder: schema.accounts.sortOrder,
      lastBalanceRefresh: schema.accounts.lastBalanceRefresh,
      oauthProvider: schema.accounts.oauthProvider,
      oauthAccountKey: schema.accounts.oauthAccountKey,
      oauthProjectId: schema.accounts.oauthProjectId,
      extraConfig: schema.accounts.extraConfig,
      createdAt: schema.accounts.createdAt,
      updatedAt: schema.accounts.updatedAt,
      siteName: schema.sites.name,
      siteUrl: schema.sites.url,
      sitePlatform: schema.sites.platform,
      siteStatus: schema.sites.status,
      siteProxyUrl: schema.sites.proxyUrl,
      siteCustomHeaders: schema.sites.customHeaders
    })
    .from(schema.accounts)
    .innerJoin(schema.sites, eq(schema.sites.id, schema.accounts.siteId))
    .where(eq(schema.accounts.id, accountId))
    .get();
  return row ?? null;
}

function skippedAccountBalanceResult(account: AccountBalanceRow): BalanceRefreshResult | null;
function skippedAccountBalanceResult(account: AccountBalanceRow, reason: string): BalanceRefreshResult;
function skippedAccountBalanceResult(account: AccountBalanceRow, reason?: string): BalanceRefreshResult | null {
  if (!reason && account.siteStatus === 'active' && account.status !== 'disabled') return null;
  return {
    accountId: account.id,
    balance: account.balance,
    used: account.balanceUsed,
    quota: account.quota,
    refreshedAt: account.lastBalanceRefresh,
    skipped: true,
    reason: reason || (account.siteStatus !== 'active' ? 'site_disabled' : 'account_disabled')
  };
}

async function saveBalanceResult(account: AccountBalanceRow, balance: BalanceInfo): Promise<BalanceRefreshResult> {
  const refreshedAt = nowIso();
  await db
    .update(schema.accounts)
    .set({
      balance: balance.balance,
      balanceUsed: balance.used,
      quota: balance.quota,
      status: account.status === 'expired' ? 'active' : account.status,
      lastBalanceRefresh: refreshedAt,
      updatedAt: refreshedAt
    })
    .where(eq(schema.accounts.id, account.id))
    .run();
  return {
    accountId: account.id,
    balance: balance.balance,
    used: balance.used,
    quota: balance.quota,
    refreshedAt,
    skipped: false,
    reason: null
  };
}

async function recordBalanceRefreshFailure(account: AccountBalanceRow, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : '余额刷新失败';
  await db.insert(schema.events).values({
    type: 'balance',
    title: '余额刷新失败',
    message: `${account.siteName} / ${account.username || account.id}: ${message}`,
    level: 'warning',
    relatedId: account.id,
    relatedType: 'account',
    createdAt: nowIso()
  }).run();
}

function accountProxyUrl(extraConfig: string | null): string | null {
  const parsed = parseJsonObject(extraConfig);
  const value = parsed?.proxyUrl;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
