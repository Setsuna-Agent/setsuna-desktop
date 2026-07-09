import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const rootDir = dirname(fileURLToPath(import.meta.url));

export const testFileGlobs = [
  'apps/**/*.test.{ts,tsx}',
  'packages/**/*.test.{ts,tsx}',
  'scripts/**/*.test.ts',
];

export const baseExcludeGlobs = [
  'node_modules/**',
  '**/node_modules/**',
  'dist/**',
  '**/dist/**',
  'release-artifacts/**',
  'release-upload/**',
  'release-logs/**',
];

// Release jobs exclude these high-variance integration suites; diagnostics run them separately.
export const integrationTestFiles = [
  'apps/desktop/main/review-state.test.ts',
  'apps/desktop/main/terminal-sessions.test.ts',
  'packages/desktop-runtime/src/adapters/skill/file-skill-registry.test.ts',
  'packages/desktop-runtime/src/adapters/store/file-memory-store.test.ts',
  'packages/desktop-runtime/src/adapters/tool/pc-local-tool-host.test.ts',
  'packages/desktop-runtime/src/adapters/tool/shell-tool-host.test.ts',
  'packages/desktop-runtime/src/loop/agent-loop-tools.test.ts',
  'packages/desktop-runtime/src/server/runtime-server.test.ts',
];

type VitestTestConfig = NonNullable<Parameters<typeof defineConfig>[0]['test']>;

export function createVitestConfig(test: VitestTestConfig = {}) {
  const { include, exclude, ...testOptions } = test;

  return defineConfig({
    plugins: [react()],
    resolve: {
      alias: {
        '@renderer': resolve(rootDir, 'apps/desktop/renderer/src'),
        '@setsuna-desktop/contracts': resolve(rootDir, 'packages/contracts/src/index.ts'),
      },
    },
    test: {
      environment: 'node',
      include: include ?? testFileGlobs,
      exclude: exclude ?? baseExcludeGlobs,
      ...testOptions,
    },
  });
}
