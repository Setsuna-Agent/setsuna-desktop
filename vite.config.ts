import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { createFeaturePackageSourceAliases } from './scripts/feature-package-aliases.js';

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
      '@setsuna-desktop/feature-core': resolve(rootDir, 'packages/feature-core/src'),
      ...createFeaturePackageSourceAliases(rootDir),
    },
  },
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('@xterm')) return 'xterm';
          return undefined;
        },
      },
    },
  },
});
