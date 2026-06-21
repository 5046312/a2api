const tokenKey = 'a2api.adminToken';
export const adminTokenClearedEvent = 'a2api:admin-token-cleared';

export function getAdminToken(): string {
  return localStorage.getItem(tokenKey) || '';
}

export function hydrateDesktopAdminTokenFromUrl(): void {
  const url = new URL(window.location.href);
  const hashParams = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : url.hash);
  const queryToken = url.searchParams.get('a2api_desktop_token')?.trim();
  const hashToken = hashParams.get('a2api_desktop_token')?.trim();
  const token = queryToken || hashToken;
  if (!token) return;
  setAdminToken(token);
  url.searchParams.delete('a2api_desktop_token');
  if (hashToken) hashParams.delete('a2api_desktop_token');
  const nextHash = hashParams.toString();
  const hash = hashToken ? (nextHash ? `#${nextHash}` : '') : url.hash;
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${hash}`);
}

export function setAdminToken(token: string): void {
  localStorage.setItem(tokenKey, token);
}

export function clearAdminToken(): void {
  localStorage.removeItem(tokenKey);
  window.dispatchEvent(new Event(adminTokenClearedEvent));
}
