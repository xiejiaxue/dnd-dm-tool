import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['shared/**/*.test.ts', 'scripts/**/*.test.ts', 'client/src/**/*.test.ts'],
  },
});
