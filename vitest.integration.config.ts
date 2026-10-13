import { createVitestConfig, integrationTestGlobs } from './vitest.shared.config';

export default createVitestConfig({
  // Fixtures own temporary data roots and ephemeral ports; keep process isolation
  // and bound concurrency because suites also spawn Electron, compilers and PTYs.
  fileParallelism: true,
  hookTimeout: 45_000,
  include: integrationTestGlobs,
  maxWorkers: 2,
  pool: 'forks',
  sequence: {
    shuffle: false,
  },
  slowTestThreshold: 5_000,
  teardownTimeout: 45_000,
  testTimeout: 60_000,
});
