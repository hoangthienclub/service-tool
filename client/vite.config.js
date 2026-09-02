import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  root: path.resolve(__dirname),
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:4000'
    }
  },
  build: {
    outDir: path.resolve(__dirname, '../dist'),
    emptyOutDir: true
  }
});
