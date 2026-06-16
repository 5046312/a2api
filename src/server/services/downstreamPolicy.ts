export type CredentialRef =
  | { kind: 'account'; siteId: number; accountId: number }
  | { kind: 'account_token'; siteId: number; accountId: number; tokenId: number };

export type DownstreamRoutingPolicy = {
  modelScope: 'all' | 'selected';
  supportedModels: string[];
  allowedRouteIds: number[];
  allowedSiteIds: number[];
  allowedCredentialRefs: CredentialRef[];
  siteWeightMultipliers: Record<string, number>;
  excludedSiteIds: number[];
  excludedCredentialRefs: CredentialRef[];
};

export const GLOBAL_ROUTING_POLICY: DownstreamRoutingPolicy = {
  modelScope: 'all',
  supportedModels: [],
  allowedRouteIds: [],
  allowedSiteIds: [],
  allowedCredentialRefs: [],
  siteWeightMultipliers: {},
  excludedSiteIds: [],
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
  input: { siteId: number; accountId: number; tokenId: number | null }
): boolean {
  if (policy.allowedSiteIds.length > 0 && !policy.allowedSiteIds.includes(input.siteId)) {
    return false;
  }
  if (policy.excludedSiteIds.includes(input.siteId)) {
    return false;
  }

  const accountRef = { kind: 'account' as const, siteId: input.siteId, accountId: input.accountId };
  const tokenRef = input.tokenId === null
    ? null
    : { kind: 'account_token' as const, siteId: input.siteId, accountId: input.accountId, tokenId: input.tokenId };

  if (policy.allowedCredentialRefs.length > 0) {
    const allowed = policy.allowedCredentialRefs.some((ref) => credentialRefEquals(ref, accountRef) || (tokenRef && credentialRefEquals(ref, tokenRef)));
    if (!allowed) return false;
  }

  return !policy.excludedCredentialRefs.some((ref) => credentialRefEquals(ref, accountRef) || (tokenRef && credentialRefEquals(ref, tokenRef)));
}

export function isModelAllowedByPolicy(model: string, routeId: number, policy: DownstreamRoutingPolicy): boolean {
  if (policy.modelScope === 'all') return true;
  if (policy.allowedRouteIds.includes(routeId)) return true;
  return policy.supportedModels.some((pattern) => wildcardMatch(pattern, model));
}

export function credentialRefEquals(left: CredentialRef, right: CredentialRef): boolean {
  if (left.kind !== right.kind) return false;
  if (left.siteId !== right.siteId || left.accountId !== right.accountId) return false;
  if (left.kind === 'account_token' && right.kind === 'account_token') {
    return left.tokenId === right.tokenId;
  }
  return left.kind === 'account';
}
