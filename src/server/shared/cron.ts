export type CronField = {
  values: Set<number>;
  wildcard: boolean;
};

export type ParsedCron = {
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  dayOfWeek: CronField;
};

export function isValidCronExpression(expression: string): boolean {
  return parseCronExpression(expression) !== null;
}

export function parseCronExpression(expression: string): ParsedCron | null {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  const parsedMinute = parseCronField(minute, 0, 59);
  const parsedHour = parseCronField(hour, 0, 23);
  const parsedDayOfMonth = parseCronField(dayOfMonth, 1, 31);
  const parsedMonth = parseCronField(month, 1, 12);
  const parsedDayOfWeek = parseCronField(dayOfWeek, 0, 7);
  if (!parsedMinute || !parsedHour || !parsedDayOfMonth || !parsedMonth || !parsedDayOfWeek) return null;
  return {
    minute: parsedMinute,
    hour: parsedHour,
    dayOfMonth: parsedDayOfMonth,
    month: parsedMonth,
    dayOfWeek: parsedDayOfWeek
  };
}

export function matchesCron(cron: ParsedCron, value: Date): boolean {
  const dayOfMonthMatches = cron.dayOfMonth.values.has(value.getDate());
  const dayOfWeekMatches = cron.dayOfWeek.values.has(value.getDay());
  const dayMatches = cron.dayOfMonth.wildcard && cron.dayOfWeek.wildcard
    ? true
    : cron.dayOfMonth.wildcard
      ? dayOfWeekMatches
      : cron.dayOfWeek.wildcard
        ? dayOfMonthMatches
        : dayOfMonthMatches || dayOfWeekMatches;

  return cron.minute.values.has(value.getMinutes())
    && cron.hour.values.has(value.getHours())
    && cron.month.values.has(value.getMonth() + 1)
    && dayMatches;
}

export function minuteKey(value: Date): string {
  return [
    value.getFullYear(),
    value.getMonth(),
    value.getDate(),
    value.getHours(),
    value.getMinutes()
  ].join(':');
}

function parseCronField(raw: string | undefined, min: number, max: number): CronField | null {
  if (!raw) return null;
  const values = new Set<number>();
  for (const segment of raw.split(',')) {
    if (!addCronSegment(values, segment.trim(), min, max)) return null;
  }
  return values.size > 0 ? { values, wildcard: raw === '*' } : null;
}

// 支持常见 cron 字段语法，避免为少量后台任务引入调度依赖。
function addCronSegment(values: Set<number>, segment: string, min: number, max: number): boolean {
  if (!segment) return false;
  const [rangePart, stepPart] = segment.split('/');
  const step = stepPart === undefined ? 1 : Number(stepPart);
  if (!Number.isInteger(step) || step < 1) return false;

  let start = min;
  let end = max;
  if (rangePart !== '*') {
    const [startRaw, endRaw] = rangePart?.split('-') ?? [];
    start = Number(startRaw);
    end = endRaw === undefined ? start : Number(endRaw);
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < min || end > max || start > end) return false;

  for (let value = start; value <= end; value += step) {
    values.add(value === 7 && max === 7 ? 0 : value);
  }
  return true;
}
