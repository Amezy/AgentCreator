import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5181,
    proxy: {
      '/api/v1/agent': {
        target: 'http://localhost:8100',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/v1\/agent/, '/api/v1'),
      },
      '/ws/agent': {
        target: 'ws://localhost:8100',
        ws: true,
        rewrite: (path) => path.replace(/^\/ws\/agent/, ''),
      },
      '/api': {
        target: 'http://localhost:3010',
        changeOrigin: true,
      },
    },
  },
});
