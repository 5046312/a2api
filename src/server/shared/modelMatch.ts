function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function modelPatternMatches(pattern: string, modelName: string): boolean {
  const normalizedPattern = pattern.trim();
  const normalizedModel = modelName.trim();
  if (!normalizedPattern || !normalizedModel) return false;
  if (normalizedPattern === normalizedModel) return true;

  const lastSlash = normalizedPattern.lastIndexOf('/');
  if (normalizedPattern.startsWith('/') && lastSlash > 0) {
    try {
      // 管理端允许高级用户用 /.../flags 表达精确禁用规则。
      const body = normalizedPattern.slice(1, lastSlash);
      const flags = normalizedPattern.slice(lastSlash + 1);
      return new RegExp(body, flags).test(normalizedModel);
    } catch {
      return false;
    }
  }

  if (normalizedPattern.includes('*')) {
    // 星号通配用于常见模型族配置，例如 gpt-*。
    const source = normalizedPattern.split('*').map(escapeRegExp).join('.*');
    return new RegExp(`^${source}$`).test(normalizedModel);
  }

  return false;
}

export function isModelDisabled(modelName: string, disabledPatterns: string[]): boolean {
  return disabledPatterns.some((pattern) => modelPatternMatches(pattern, modelName));
}
