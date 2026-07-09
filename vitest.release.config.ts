import { baseExcludeGlobs, createVitestConfig, integrationTestFiles } from './vitest.shared.config';

export default createVitestConfig({
  exclude: [
    ...baseExcludeGlobs,
    ...integrationTestFiles,
  ],
  hookTimeout: 20_000,
  maxWorkers: process.env.CI ? 2 : undefined,
  slowTestThreshold: 1_000,
  teardownTimeout: 20_000,
  testTimeout: 12_000,
});
