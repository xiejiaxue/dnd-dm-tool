import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  server: {
    port: 5173,
    host: '0.0.0.0',
    fs: { allow: [path.resolve(__dirname, '..')] },
    proxy: {
      // Wrangler owns the local D1/R2/Durable Object state.  Keeping the Vite
      // dev server as a same-origin-looking proxy lets browser cookies and the
      // room WebSocket follow exactly the same path as production.
      '/api': { target: 'http://localhost:8787', ws: true },
    },
  },
  build: { outDir: 'dist' },
});
