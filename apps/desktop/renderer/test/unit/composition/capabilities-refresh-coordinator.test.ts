import { describe, expect, it, vi } from 'vitest';
import { createCapabilitiesRefreshCoordinator } from '../../../src/composition/capabilities-refresh-coordinator.js';
import { reportRuntimeBackgroundFailure } from '../../../src/services/runtime-client/runtimeClientErrors.js';

vi.mock('../../../src/services/runtime-client/runtimeClientErrors.js', () => ({
  reportRuntimeBackgroundFailure: vi.fn(),
}));

describe('capabilities refresh coordinator', () => {
  it('deduplicates owners and isolates a failing catalog refresh', async () => {
    const coordinator = createCapabilitiesRefreshCoordinator();
    const refreshMcp = vi.fn().mockRejectedValue(new Error('offline'));
    const refreshSkills = vi.fn().mockResolvedValue(undefined);
    coordinator.register('mcp', refreshMcp);
    coordinator.register('skills', refreshSkills);

    await expect(coordinator.refresh(['mcp', 'skills', 'mcp'])).resolves.toBeUndefined();

    expect(refreshMcp).toHaveBeenCalledTimes(1);
    expect(refreshSkills).toHaveBeenCalledTimes(1);
    expect(reportRuntimeBackgroundFailure).toHaveBeenCalledWith(
      'mcp capabilities refresh',
      expect.any(Error),
    );
  });

  it('removes only the operation owned by its disposer', async () => {
    const coordinator = createCapabilitiesRefreshCoordinator();
    const refresh = vi.fn().mockResolvedValue(undefined);
    const dispose = coordinator.register('plugin-management', refresh);
    expect(() => coordinator.register('plugin-management', refresh)).toThrow(/already registered/u);

    dispose();
    await coordinator.refresh(['plugin-management']);

    expect(refresh).not.toHaveBeenCalled();
  });
});
