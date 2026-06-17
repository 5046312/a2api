import { runDueMonitorChecks } from './accountMonitorService.js';

let schedulerTimer: ReturnType<typeof setInterval> | null = null;
let running = false;

export function startAccountMonitorScheduler(): void {
  if (schedulerTimer) return;
  schedulerTimer = setInterval(() => {
    void runSchedulerTick();
  }, 30_000);
  schedulerTimer.unref?.();
  void runSchedulerTick();
}

export function stopAccountMonitorScheduler(): void {
  if (schedulerTimer) clearInterval(schedulerTimer);
  schedulerTimer = null;
  running = false;
}

async function runSchedulerTick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await runDueMonitorChecks();
  } catch (error) {
    console.warn('[accountMonitorScheduler] monitor check failed', error);
  } finally {
    running = false;
  }
}
