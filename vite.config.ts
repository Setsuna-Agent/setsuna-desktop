import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
  },
  resolve: {
    alias: {
      '@renderer': resolve(rootDir, 'apps/desktop/renderer/src'),
      '@setsuna-desktop/contracts': resolve(rootDir, 'packages/contracts/src/index.ts'),
    },
  },
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('@iconify-json/vscode-icons')) return 'vscode-icons';
          if (id.includes('@xterm')) return 'xterm';
          return undefined;
        },
      },
    },
  },
});
