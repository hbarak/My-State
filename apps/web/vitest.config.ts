import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/adapters/__tests__/**/*.{test,spec}.ts'],
    exclude: ['node_modules', 'dist'],
  },
});
