import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pricePlugin } from '../api/src/plugins/price-plugin';
import { boiRatePlugin } from '../api/src/plugins/boi-rate-plugin';
import { psagotProxyPlugin } from '../api/src/plugins/psagot-proxy-plugin';
import { psagotMockPlugin } from '../api/src/plugins/psagot-mock-plugin';
import { ibProxyPlugin } from '../api/src/plugins/ib-proxy-plugin';
import { ibMockPlugin } from '../api/src/plugins/ib-mock-plugin';

const root = fileURLToPath(new URL('../..', import.meta.url));
const useMockApi = process.env.VITE_MOCK_API === 'true';

export default defineConfig({
  plugins: [
    react(),
    pricePlugin(),
    boiRatePlugin(),
    useMockApi ? psagotMockPlugin() : psagotProxyPlugin(),
    useMockApi ? ibMockPlugin() : ibProxyPlugin(),
  ],
  resolve: {
    alias: {
      '@my-stocks/domain': resolve(root, 'packages/domain/src/index.ts'),
      '@my-stocks/infra': resolve(root, 'packages/infra/src/index.ts'),
      '@my-stocks/api': resolve(root, 'apps/api/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  optimizeDeps: {
    exclude: ['@react-native-async-storage/async-storage'],
  },
});
