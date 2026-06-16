import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@web': fileURLToPath(new URL('./src/web', import.meta.url)),
      '@pages': fileURLToPath(new URL('./src/web/pages', import.meta.url)),
      '@styles': fileURLToPath(new URL('./src/web/styles', import.meta.url)),
      '@server': fileURLToPath(new URL('./src/server', import.meta.url))
    }
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:4000',
      '/v1': 'http://127.0.0.1:4000'
    }
  },
  build: {
    outDir: 'dist/web',
    emptyOutDir: true
  }
});
