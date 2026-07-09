import { createVitestConfig, integrationTestFiles } from './vitest.shared.config';

export default createVitestConfig({
  fileParallelism: false,
  hookTimeout: 45_000,
  include: integrationTestFiles,
  maxWorkers: 1,
  minWorkers: 1,
  pool: 'forks',
  sequence: {
    shuffle: false,
  },
  slowTestThreshold: 5_000,
  teardownTimeout: 45_000,
  testTimeout: 60_000,
});
