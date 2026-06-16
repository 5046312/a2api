import { randomUUID } from 'node:crypto';
import { nowIso } from '../shared/time.js';

export type BackgroundTaskStatus = 'pending' | 'running' | 'succeeded' | 'failed';

export type BackgroundTaskLogEntry = {
  seq: number;
  message: string;
  createdAt: string;
};

export type BackgroundTask = {
  id: string;
  type: string;
  title: string;
  status: BackgroundTaskStatus;
  message: string;
  error: string | null;
  result: unknown;
  dedupeKey: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  expiresAtMs: number;
  logs: BackgroundTaskLogEntry[];
};

export type StartBackgroundTaskOptions = {
  type: string;
  title: string;
  dedupeKey?: string | undefined;
  keepMs?: number | undefined;
};

const TASK_TTL_MS = 6 * 60 * 60 * 1000;
const TASK_CLEANUP_INTERVAL_MS = 60 * 1000;
const TASK_LOG_LIMIT = 200;

const tasks = new Map<string, BackgroundTask>();
const dedupeTaskIds = new Map<string, string>();
const taskLogSeq = new Map<string, number>();
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function summarizeError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error.trim();
  try {
    return JSON.stringify(error) || 'unknown error';
  } catch {
    return 'unknown error';
  }
}

function setTaskStatus(taskId: string, patch: Partial<BackgroundTask>): BackgroundTask | null {
  const current = tasks.get(taskId);
  if (!current) return null;
  const next: BackgroundTask = { ...current, ...patch, updatedAt: nowIso() };
  tasks.set(taskId, next);
  return next;
}

function cleanupExpiredTasks(): void {
  const now = Date.now();
  for (const [taskId, task] of tasks.entries()) {
    if (task.expiresAtMs > now) continue;
    tasks.delete(taskId);
    taskLogSeq.delete(taskId);
    if (task.dedupeKey && dedupeTaskIds.get(task.dedupeKey) === taskId) {
      dedupeTaskIds.delete(task.dedupeKey);
    }
  }
}

function ensureCleanupTimer(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(cleanupExpiredTasks, TASK_CLEANUP_INTERVAL_MS);
  cleanupTimer.unref?.();
}

export function appendBackgroundTaskLog(taskId: string, message: string): BackgroundTaskLogEntry | null {
  const task = tasks.get(taskId);
  const normalizedMessage = String(message || '').trim();
  if (!task || !normalizedMessage) return null;

  const seq = (taskLogSeq.get(taskId) || 0) + 1;
  taskLogSeq.set(taskId, seq);

  const entry: BackgroundTaskLogEntry = { seq, message: normalizedMessage, createdAt: nowIso() };
  const logs = [...task.logs, entry].slice(-TASK_LOG_LIMIT);
  tasks.set(taskId, { ...task, logs, updatedAt: nowIso() });
  return entry;
}

async function runBackgroundTask(taskId: string, runner: () => Promise<unknown>): Promise<void> {
  const startedAt = nowIso();
  setTaskStatus(taskId, { status: 'running', startedAt, message: '任务执行中' });

  try {
    const result = await runner();
    setTaskStatus(taskId, {
      status: 'succeeded',
      finishedAt: nowIso(),
      message: '任务已完成',
      error: null,
      result
    });
  } catch (error) {
    const errorMessage = summarizeError(error);
    setTaskStatus(taskId, {
      status: 'failed',
      finishedAt: nowIso(),
      message: `任务失败：${errorMessage}`,
      error: errorMessage
    });
  } finally {
    const task = tasks.get(taskId);
    if (task?.dedupeKey && dedupeTaskIds.get(task.dedupeKey) === taskId) {
      dedupeTaskIds.delete(task.dedupeKey);
    }
  }
}

export function startBackgroundTask(
  options: StartBackgroundTaskOptions,
  runner: () => Promise<unknown>
): { task: BackgroundTask; reused: boolean } {
  ensureCleanupTimer();
  const dedupeKey = options.dedupeKey?.trim() || '';
  if (dedupeKey) {
    const existingTaskId = dedupeTaskIds.get(dedupeKey);
    const existing = existingTaskId ? tasks.get(existingTaskId) : null;
    if (existing && (existing.status === 'pending' || existing.status === 'running')) {
      return { task: existing, reused: true };
    }
  }

  const createdAt = nowIso();
  const task: BackgroundTask = {
    id: randomUUID(),
    type: options.type,
    title: options.title,
    status: 'pending',
    message: '任务已创建',
    error: null,
    result: null,
    dedupeKey: dedupeKey || null,
    createdAt,
    updatedAt: createdAt,
    startedAt: null,
    finishedAt: null,
    expiresAtMs: Date.now() + Math.max(60_000, options.keepMs ?? TASK_TTL_MS),
    logs: []
  };

  tasks.set(task.id, task);
  taskLogSeq.set(task.id, 0);
  if (dedupeKey) dedupeTaskIds.set(dedupeKey, task.id);
  void runBackgroundTask(task.id, runner);
  return { task, reused: false };
}

export function getBackgroundTask(taskId: string): BackgroundTask | null {
  return tasks.get(taskId) || null;
}

export function listBackgroundTasks(limit = 50): BackgroundTask[] {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.trunc(limit))) : 50;
  return [...tasks.values()]
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, safeLimit);
}
