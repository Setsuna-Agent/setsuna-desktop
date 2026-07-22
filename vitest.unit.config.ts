import { baseExcludeGlobs, createVitestConfig, integrationTestGlobs } from './vitest.shared.config';

export default createVitestConfig({
  exclude: [
    ...baseExcludeGlobs,
    ...integrationTestGlobs,
  ],
  hookTimeout: 15_000,
  slowTestThreshold: 1_000,
  teardownTimeout: 15_000,
  testTimeout: 10_000,
});
