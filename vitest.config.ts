import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['server/src/**/*.test.ts', 'server/test/**/*.test.ts', 'client/src/**/*.test.ts'],
  },
});
