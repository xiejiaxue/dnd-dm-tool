import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [cloudflareTest({
    wrangler: { configPath: './wrangler.jsonc' },
    // Wrangler's current local workerd release trails the production
    // compatibility-date clock by two days. Production stays pinned to the
    // current date in wrangler.jsonc; this only makes the local test runtime
    // executable until its next workerd release lands.
    miniflare: { compatibilityDate: '2026-08-08' },
  })],
  test: {
    include: ['worker/test/**/*.test.ts'],
    globals: true,
  },
});
