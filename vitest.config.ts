import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only include domain tests, exclude E2E (Playwright) tests
    include: ['packages/domain/tests/**/*.{test,spec}.ts'],
    exclude: ['node_modules', 'dist', '.idea', '.git', '.cache'],
  },
});
