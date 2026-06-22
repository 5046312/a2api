import { ref } from 'vue';

const defaultCostDisplayDigits = 6;
const maxCostDisplayDigits = 12;

export const costDisplayDigits = ref(defaultCostDisplayDigits);

export function normalizeCostDisplayDigits(value: unknown): number {
  const digits = Math.trunc(Number(value));
  if (!Number.isFinite(digits)) return defaultCostDisplayDigits;
  return Math.min(maxCostDisplayDigits, Math.max(0, digits));
}

export function setCostDisplayDigits(value: unknown): void {
  costDisplayDigits.value = normalizeCostDisplayDigits(value);
}

export function roundCostValue(value: number, digits = costDisplayDigits.value): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** normalizeCostDisplayDigits(digits);
  return Math.round(value * factor) / factor;
}

export function formatCostText(
  value: number | null | undefined,
  options: { prefix?: string; emptyText?: string; emptyWhenZero?: boolean } = {}
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return options.emptyText ?? '-';
  if (options.emptyWhenZero && value <= 0) return options.emptyText ?? '-';
  const digits = costDisplayDigits.value;
  return `${options.prefix ?? ''}${roundCostValue(value, digits).toFixed(digits)}`;
}
