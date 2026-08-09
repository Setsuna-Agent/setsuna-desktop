import { baseExcludeGlobs, createVitestConfig } from './vitest.shared.config';

const releasePlatformTestGlobs = [
  'apps/desktop/main/test/unit/**/*.test.{ts,tsx}',
  'apps/desktop/main/test/integration/review/review-state.test.ts',
  'packages/desktop-runtime/test/adapters/search/**/*.test.{ts,tsx}',
  'packages/desktop-runtime/test/adapters/store/**/*.test.{ts,tsx}',
  'packages/desktop-runtime/test/adapters/tool/pc-local/**/*.test.{ts,tsx}',
  'packages/desktop-runtime/test/adapters/workspace/**/*.test.{ts,tsx}',
  'packages/desktop-runtime/test/integration/adapters/tool/pc-local-tool-host.*.test.ts',
  'packages/desktop-runtime/test/security/**/*.test.{ts,tsx}',
  'packages/desktop-runtime/test/server/app-server/command-process-runtime.test.ts',
  'scripts/test/**/*.test.ts',
];

export default createVitestConfig({
  exclude: baseExcludeGlobs,
  fileParallelism: false,
  hookTimeout: 20_000,
  include: releasePlatformTestGlobs,
  maxWorkers: 1,
  minWorkers: 1,
  slowTestThreshold: 1_000,
  teardownTimeout: 20_000,
  testTimeout: 12_000,
});
