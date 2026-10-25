import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 5173,
    // Same-origin in dev so the httpOnly SameSite=Strict cookies flow to the API.
    proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: false } },
  },
});
