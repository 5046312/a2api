import { config, type TemporaryDisableRule } from '../config.js';

export type TemporaryDisableMatch = {
  rule: TemporaryDisableRule;
  ruleIndex: number;
  matchedKeyword: string;
};

export function matchTemporaryDisableRule(status: number | null, rawText: string): TemporaryDisableMatch | null {
  const text = rawText.toLowerCase();
  for (let index = 0; index < config.temporaryDisableRules.length; index += 1) {
    const rule = config.temporaryDisableRules[index]!;
    const matchType = rule.matchType ?? 'http_status';
    if (status === null && matchType !== 'fetch_error') continue;
    if (status !== null && (matchType !== 'http_status' || rule.statusCode !== status)) continue;
    const matchedKeyword = rule.keywords.find((keyword) => text.includes(keyword.toLowerCase()));
    if (matchedKeyword) return { rule, ruleIndex: index, matchedKeyword };
  }
  return null;
}

export function buildTemporaryDisableReason(error: string, match: TemporaryDisableMatch, cooldownUntil: string): string {
  const description = match.rule.description ? `，${match.rule.description}` : '';
  const target = (match.rule.matchType ?? 'http_status') === 'fetch_error' ? '网络错误' : `HTTP ${match.rule.statusCode}`;
  return `${error}；命中临时禁用规则 #${match.ruleIndex + 1}：${target} / ${match.matchedKeyword}${description}，冷却至 ${cooldownUntil}`;
}
