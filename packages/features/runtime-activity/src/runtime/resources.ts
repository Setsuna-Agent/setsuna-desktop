import type { ProcessResourceSnapshot } from '../contracts/index.js';

/** The independently spawned runtime is not necessarily included in Electron's metrics. */
export function sampleRuntimeProcess(): ProcessResourceSnapshot {
  const cpu = process.cpuUsage();
  return {
    sampledAt: performance.now(),
    processes: [{
      pid: process.pid,
      startedAt: performance.timeOrigin,
      type: 'Runtime',
      name: 'Setsuna Agent Runtime',
      cpuTimeSeconds: (cpu.user + cpu.system) / 1_000_000,
      residentBytes: process.memoryUsage.rss(),
      canTerminate: false,
      pages: [],
    }],
  };
}
