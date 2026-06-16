import { config } from '../config.js';
import { matchesCron, minuteKey, parseCronExpression, type ParsedCron } from '../shared/cron.js';
import { refreshAllAccountBalances } from './balanceService.js';

let schedulerTimer: ReturnType<typeof setInterval> | null = null;
let activeCron: ParsedCron | null = null;
let lastRunKey: string | null = null;
let running = false;

export function startBalanceRefreshScheduler(): void {
  updateBalanceRefreshCron(config.balanceRefreshCron);
}

export function stopBalanceRefreshScheduler(): void {
  if (schedulerTimer) clearInterval(schedulerTimer);
  schedulerTimer = null;
  activeCron = null;
  lastRunKey = null;
  running = false;
}

export function updateBalanceRefreshCron(expression: string): void {
  const parsed = parseCronExpression(expression);
  if (!parsed) throw new Error(`Invalid balance refresh cron: ${expression}`);
  config.balanceRefreshCron = expression;
  activeCron = parsed;
  lastRunKey = null;
  if (!schedulerTimer) {
    schedulerTimer = setInterval(() => {
      void runDueBalanceRefresh(new Date());
    }, 60_000);
    schedulerTimer.unref?.();
  }
}

export async function runDueBalanceRefresh(now = new Date()): Promise<void> {
  if (!activeCron || running) return;
  if (!matchesCron(activeCron, now)) return;
  const runKey = minuteKey(now);
  if (lastRunKey === runKey) return;
  lastRunKey = runKey;
  running = true;
  try {
    await refreshAllAccountBalances();
  } catch (error) {
    console.warn('[balanceScheduler] balance refresh failed', error);
  } finally {
    running = false;
  }
}
