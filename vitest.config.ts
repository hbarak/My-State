import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Domain tests + web adapter tests. Excludes E2E (Playwright) tests.
    include: [
      'packages/domain/tests/**/*.{test,spec}.ts',
      'apps/web/src/adapters/__tests__/**/*.{test,spec}.ts',
      'apps/web/src/hooks/__tests__/**/*.{test,spec}.ts',
      'apps/web/src/portfolio/__tests__/**/*.{test,spec}.ts',
      'apps/web/src/migration/__tests__/**/*.{test,spec}.ts',
      'apps/api/__tests__/**/*.{test,spec}.ts',
    ],
    exclude: ['node_modules', 'dist', '.idea', '.git', '.cache'],
  },
});
