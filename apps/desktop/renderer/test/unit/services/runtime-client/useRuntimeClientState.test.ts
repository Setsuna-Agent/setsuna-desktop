import type { DesktopRuntimeClient } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { loadRuntimeBootstrap } from '../../../../src/services/runtime-client/useRuntimeClientState.js';

describe('loadRuntimeBootstrap', () => {
  it('keeps optional domain failures from rejecting the core bootstrap', async () => {
    const client = bootstrapClient();
    client.listSkills = async () => {
      throw new Error('skills unavailable');
    };

    const bootstrap = await loadRuntimeBootstrap(client);

    expect(bootstrap.core.threadList.threads).toEqual([]);
    expect(bootstrap.optional.skillResult).toMatchObject({ status: 'rejected' });
    expect(bootstrap.optional).not.toHaveProperty('mcpResult');
  });

  it('still rejects when required runtime state cannot load', async () => {
    const client = bootstrapClient();
    client.getConfig = async () => {
      throw new Error('config unavailable');
    };

    await expect(loadRuntimeBootstrap(client)).rejects.toThrow('config unavailable');
  });
});

function bootstrapClient(): Pick<
  DesktopRuntimeClient,
  'getConfig' | 'listProjects' | 'listSkills' | 'listThreads'
> {
  return {
    getConfig: async () => ({ providers: [] }) as unknown as Awaited<ReturnType<DesktopRuntimeClient['getConfig']>>,
    listProjects: async () => ({ projects: [] }),
    listSkills: async () => ({ skills: [], extraRoots: [] }),
    listThreads: async () => ({ threads: [] }),
  };
}
