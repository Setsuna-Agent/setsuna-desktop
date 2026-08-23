import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const rootDir = dirname(fileURLToPath(import.meta.url));

export const testFileGlobs = [
  'apps/**/test/**/*.test.{ts,tsx}',
  'packages/**/test/**/*.test.{ts,tsx}',
  'scripts/test/**/*.test.ts',
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

// 集成测试按目录归类，新增套件无需再同步维护一份易遗漏的文件清单。
export const integrationTestGlobs = [
  'apps/**/test/integration/**/*.test.{ts,tsx}',
  'packages/**/test/integration/**/*.test.{ts,tsx}',
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
        '@setsuna-desktop/feature-core': resolve(rootDir, 'packages/feature-core/src'),
        '@setsuna-desktop/feature-browser': resolve(rootDir, 'packages/features/browser/src'),
        '@setsuna-desktop/feature-image-generation': resolve(rootDir, 'packages/features/image-generation/src'),
        '@setsuna-desktop/feature-goal': resolve(rootDir, 'packages/features/goal/src'),
        '@setsuna-desktop/feature-review': resolve(rootDir, 'packages/features/review/src'),
        '@setsuna-desktop/feature-terminal': resolve(rootDir, 'packages/features/terminal/src'),
        '@setsuna-desktop/feature-vision-recognition': resolve(rootDir, 'packages/features/vision-recognition/src'),
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
