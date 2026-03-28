import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { eodhdPricePlugin } from './src/server/eodhd-price-plugin';

export default defineConfig({
  plugins: [react(), eodhdPricePlugin()],
  optimizeDeps: {
    exclude: ['@react-native-async-storage/async-storage'],
  },
});
