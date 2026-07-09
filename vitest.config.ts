import { createVitestConfig } from './vitest.shared.config';

export default createVitestConfig({
  fileParallelism: false,
  hookTimeout: 30_000,
  maxWorkers: 1,
  minWorkers: 1,
  pool: 'forks',
  sequence: {
    shuffle: false,
  },
  slowTestThreshold: 2_000,
  teardownTimeout: 30_000,
  testTimeout: 60_000,
});
