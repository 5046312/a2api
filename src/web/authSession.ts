const tokenKey = 'a2api.adminToken';

export function getAdminToken(): string {
  return localStorage.getItem(tokenKey) || '';
}

export function setAdminToken(token: string): void {
  localStorage.setItem(tokenKey, token);
}

export function clearAdminToken(): void {
  localStorage.removeItem(tokenKey);
}
