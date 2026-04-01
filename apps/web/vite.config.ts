import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { pricePlugin } from './src/server/price-plugin';
import { psagotProxyPlugin } from './src/server/psagot-proxy-plugin';
import { psagotMockPlugin } from './src/server/psagot-mock-plugin';

const useMockApi = process.env.VITE_MOCK_API === 'true';

export default defineConfig({
  plugins: [react(), pricePlugin(), useMockApi ? psagotMockPlugin() : psagotProxyPlugin()],
  optimizeDeps: {
    exclude: ['@react-native-async-storage/async-storage'],
  },
});
