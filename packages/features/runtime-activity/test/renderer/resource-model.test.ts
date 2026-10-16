import { expect, it } from 'vitest';
import type { ProcessResourceSample } from '../../src/contracts/index.js';
import { mergeResourceProcesses, processResourceUsage } from '../../src/renderer/resource-model.js';

const sample = (patch: Partial<ProcessResourceSample> = {}): ProcessResourceSample => ({
  pid: 1, startedAt: 123, type: 'Tab', name: '', cpuTimeSeconds: 1,
  residentBytes: 1024, canTerminate: false, pages: [{ id: 1, title: 'First', url: 'https://example.test' }], ...patch,
});

it('calculates per-core CPU from each source clock and avoids first-sample or reused-PID readings', () => {
  const previous = { sampledAt: 1000, processes: [sample()] };
  const next = { sampledAt: 3000, processes: [sample({ cpuTimeSeconds: 2 })] };
  expect(processResourceUsage(next, previous)[0].cpuPercent).toBe(50);
  expect(processResourceUsage(next, null)[0].cpuPercent).toBeNull();
  expect(processResourceUsage({ ...next, processes: [sample({ startedAt: 456 })] }, previous)[0].cpuPercent).toBeNull();
  expect(processResourceUsage({ ...next, sampledAt: 1000 }, previous)[0].cpuPercent).toBeNull();
});

it('does not duplicate the runtime PID or assign process memory separately to each page', () => {
  const desktop = { ...sample({ pages: [{ id: 1, title: 'First', url: '' }, { id: 2, title: 'Second', url: '' }] }), cpuPercent: null };
  const runtime = { ...sample({ pid: 2, type: 'Runtime', name: 'Setsuna Agent Runtime', pages: [], residentBytes: 2048 }), cpuPercent: null };
  const result = mergeResourceProcesses([desktop, { ...runtime, type: 'Utility' }], [runtime]);
  expect(result).toEqual([runtime, desktop]);
  expect(result.reduce((bytes, item) => bytes + item.residentBytes, 0)).toBe(3072);
});
