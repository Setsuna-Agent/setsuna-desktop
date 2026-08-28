import type { DesktopRuntimeClient } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { loadRuntimeBootstrap } from '../../../../src/services/runtime-client/useRuntimeClientState.js';

describe('loadRuntimeBootstrap', () => {
  it('loads only the required Core bootstrap state', async () => {
    const client = bootstrapClient();

    const bootstrap = await loadRuntimeBootstrap(client);

    expect(bootstrap.core.threadList.threads).toEqual([]);
    expect(bootstrap).not.toHaveProperty('optional');
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
  'getConfig' | 'listProjects' | 'listThreads'
> {
  return {
    getConfig: async () => ({ providers: [] }) as unknown as Awaited<ReturnType<DesktopRuntimeClient['getConfig']>>,
    listProjects: async () => ({ projects: [] }),
    listThreads: async () => ({ threads: [] }),
  };
}
