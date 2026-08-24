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
      '@setsuna-desktop/feature-core': resolve(rootDir, 'packages/feature-core/src'),
      '@setsuna-desktop/feature-browser': resolve(rootDir, 'packages/features/browser/src'),
      '@setsuna-desktop/feature-collaboration': resolve(rootDir, 'packages/features/collaboration/src'),
      '@setsuna-desktop/feature-image-generation': resolve(rootDir, 'packages/features/image-generation/src'),
      '@setsuna-desktop/feature-goal': resolve(rootDir, 'packages/features/goal/src'),
      '@setsuna-desktop/feature-memory': resolve(rootDir, 'packages/features/memory/src'),
      '@setsuna-desktop/feature-review': resolve(rootDir, 'packages/features/review/src'),
      '@setsuna-desktop/feature-terminal': resolve(rootDir, 'packages/features/terminal/src'),
      '@setsuna-desktop/feature-vision-recognition': resolve(rootDir, 'packages/features/vision-recognition/src'),
      '@setsuna-desktop/feature-webdav-sync': resolve(rootDir, 'packages/features/webdav-sync/src'),
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
