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
    expect(bootstrap.optional.mcpResult).toMatchObject({ status: 'fulfilled' });
    expect(bootstrap.optional.pluginResult).toMatchObject({ status: 'fulfilled' });
    expect(bootstrap.optional.pluginMarketplaceResult).toMatchObject({ status: 'fulfilled' });
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
  'getConfig' | 'getUsage' | 'listMcpServers' | 'listPluginMarketplace' | 'listPlugins' | 'listProjects' | 'listSkills' | 'listThreads'
> {
  return {
    getConfig: async () => ({ providers: [] }) as unknown as Awaited<ReturnType<DesktopRuntimeClient['getConfig']>>,
    getUsage: async () => ({}) as Awaited<ReturnType<DesktopRuntimeClient['getUsage']>>,
    listMcpServers: async () => ({ servers: [] }) as unknown as Awaited<ReturnType<DesktopRuntimeClient['listMcpServers']>>,
    listPluginMarketplace: async () => ({ plugins: [], errors: [] }),
    listPlugins: async () => ({ plugins: [] }),
    listProjects: async () => ({ projects: [] }),
    listSkills: async () => ({ skills: [], extraRoots: [] }),
    listThreads: async () => ({ threads: [] }),
  };
}
