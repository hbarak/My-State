import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { yahooFinancePlugin } from './src/server/yahooFinancePlugin';

export default defineConfig({
  plugins: [react(), yahooFinancePlugin()],
  optimizeDeps: {
    exclude: ['@react-native-async-storage/async-storage'],
  },
});
