import { defineStore } from 'pinia';
import { api } from '@web/api';
import { adminTokenClearedEvent, clearAdminToken, getAdminToken, setAdminToken } from '@web/authSession';

export const useAdminSessionStore = defineStore('adminSession', {
  state: () => ({
    authed: Boolean(getAdminToken()),
    booted: false
  }),
  actions: {
    bindTokenEvents() {
      // API 层遇到 401/403 会清理本地 Token，这里同步 Pinia 登录态。
      window.addEventListener(adminTokenClearedEvent, () => {
        this.authed = false;
        this.booted = true;
      });
    },
    async bootstrap() {
      if (!getAdminToken()) {
        this.authed = false;
        this.booted = true;
        return;
      }

      try {
        await api.authCheck();
        this.authed = true;
      } catch {
        this.authed = false;
      } finally {
        this.booted = true;
      }
    },
    async login(token: string) {
      // Token 先写入本地存储，后续 authCheck 才能带上 Authorization。
      setAdminToken(token);
      await api.authCheck();
      this.authed = true;
      this.booted = true;
    },
    logout() {
      clearAdminToken();
      this.authed = false;
      this.booted = true;
    }
  }
});
