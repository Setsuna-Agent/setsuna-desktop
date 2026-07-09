import { baseExcludeGlobs, createVitestConfig, integrationTestFiles } from './vitest.shared.config';

export default createVitestConfig({
  exclude: [
    ...baseExcludeGlobs,
    ...integrationTestFiles,
  ],
  hookTimeout: 15_000,
  slowTestThreshold: 1_000,
  teardownTimeout: 15_000,
  testTimeout: 10_000,
});
