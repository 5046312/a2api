export type CredentialRef =
  | { kind: 'account'; accountId: number }
  | { kind: 'account_token'; accountId: number; tokenId: number };

export type DownstreamRoutingPolicy = {
  modelScope: 'all' | 'selected';
  supportedModels: string[];
  allowedRouteIds: number[];
  allowedCredentialRefs: CredentialRef[];
  excludedCredentialRefs: CredentialRef[];
};

export const GLOBAL_ROUTING_POLICY: DownstreamRoutingPolicy = {
  modelScope: 'all',
  supportedModels: [],
  allowedRouteIds: [],
  allowedCredentialRefs: [],
  excludedCredentialRefs: []
};

export function wildcardMatch(pattern: string, value: string): boolean {
  if (pattern.startsWith('re:')) {
    try {
      return new RegExp(pattern.slice(3)).test(value);
    } catch {
      return false;
    }
  }
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`).test(value);
}

export function isCredentialAllowed(
  policy: DownstreamRoutingPolicy,
  input: { accountId: number; tokenId: number | null }
): boolean {
  const accountRef = { kind: 'account' as const, accountId: input.accountId };

  if (policy.allowedCredentialRefs.length > 0) {
    const allowed = policy.allowedCredentialRefs.some((ref) => credentialRefEquals(ref, accountRef));
    if (!allowed) return false;
  }

  return !policy.excludedCredentialRefs.some((ref) => credentialRefEquals(ref, accountRef));
}

export function isModelAllowedByPolicy(model: string, routeId: number, policy: DownstreamRoutingPolicy): boolean {
  if (policy.modelScope === 'all') return true;
  if (policy.allowedRouteIds.includes(routeId)) return true;
  return policy.supportedModels.some((pattern) => wildcardMatch(pattern, model));
}

export function credentialRefEquals(left: CredentialRef, right: CredentialRef): boolean {
  // 旧 account_token 策略按账号折算，当前路由不再按独立 key 生成通道。
  if (left.accountId !== right.accountId) return false;
  if (left.kind === 'account_token' && right.kind === 'account_token') {
    return left.tokenId === right.tokenId;
  }
  return true;
}
