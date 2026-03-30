import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { pricePlugin } from './src/server/price-plugin';
import { psagotProxyPlugin } from './src/server/psagot-proxy-plugin';

export default defineConfig({
  plugins: [react(), pricePlugin(), psagotProxyPlugin()],
  optimizeDeps: {
    exclude: ['@react-native-async-storage/async-storage'],
  },
});
