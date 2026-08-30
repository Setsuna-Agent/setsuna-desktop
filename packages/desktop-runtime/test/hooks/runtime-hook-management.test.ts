import type {
  RuntimeConfigInput,
  RuntimeConfigState,
} from '@setsuna-desktop/contracts';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { RuntimeHookManagement } from '../../src/hooks/runtime-hook-management.js';
import type { ConfigStore } from '../../src/ports/config-store.js';

describe('RuntimeHookManagement', () => {
  it('projects opaque renderer data and safely applies state and delete mutations', async () => {
    const configPath = path.resolve('/tmp/setsuna/runtime/config.json');
    const pluginSourcePath = path.resolve('/tmp/setsuna/plugins/guard/hooks.json');
    const firstKey = `${configPath}:pre_tool_use:0:0`;
    const secondKey = `${configPath}:pre_tool_use:0:1`;
    const pluginKey = `${pluginSourcePath}:post_tool_use:0:0`;
    let config = runtimeConfig(configPath, pluginSourcePath, {
      [secondKey]: { enabled: false },
      [pluginKey]: { enabled: false, trustedHash: 'managed-hash' },
    });
    const store: ConfigStore = {
      getActiveProviderConfig: async () => null,
      getConfig: async () => config,
      saveConfig: async (input: RuntimeConfigInput) => {
        config = { ...config, ...input } as RuntimeConfigState;
        return config;
      },
    };
    const management = new RuntimeHookManagement(store);

    const snapshot = await management.list({ cwd: '/workspace/demo' });
    const standalone = snapshot.hooks.find((hook) => hook.command === 'echo first');
    const plugin = snapshot.hooks.find((hook) => hook.pluginId === 'guard');
    expect(standalone).toBeDefined();
    expect(plugin).toMatchObject({ command: null, pluginHookId: 'guard-shell' });
    expect(JSON.stringify(snapshot)).not.toContain(configPath);
    expect(JSON.stringify(snapshot)).not.toContain(pluginSourcePath);

    await expect(management.setState({
      currentHash: 'stale-hash',
      managementId: standalone!.managementId,
      trusted: true,
    })).resolves.toEqual({ status: 'changed' });
    const trusted = await management.setState({
      currentHash: standalone!.currentHash,
      managementId: standalone!.managementId,
      trusted: true,
    });
    expect(trusted.status).toBe('updated');
    expect(config.hooks?.state?.[firstKey]?.trustedHash).toBe(standalone!.currentHash);

    const deleted = await management.deleteStandalone({
      currentHash: standalone!.currentHash,
      managementId: standalone!.managementId,
    });
    expect(deleted.status).toBe('updated');
    expect(config.hooks?.PreToolUse?.[0]?.hooks).toEqual([expect.objectContaining({ command: 'echo second' })]);
    expect(config.hooks?.state?.[firstKey]).toEqual({ enabled: false });
    expect(config.hooks?.state?.[secondKey]).toBeUndefined();
    expect(config.hooks?.state?.[pluginKey]).toEqual({ enabled: false, trustedHash: 'managed-hash' });
  });
});

function runtimeConfig(
  configPath: string,
  pluginSourcePath: string,
  state: NonNullable<RuntimeConfigState['hooks']>['state'],
): RuntimeConfigState {
  return {
    approvalPolicy: 'on-request',
    configPath,
    dataPath: '/tmp/setsuna/runtime',
    globalPrompt: '',
    hooks: {
      PreToolUse: [{
        matcher: 'shell',
        hooks: [
          { command: 'echo first', type: 'command' },
          { command: 'echo second', type: 'command' },
        ],
      }],
      PostToolUse: [{
        matcher: 'write_file',
        hooks: [{
          command: 'node guard.mjs',
          pluginHookId: 'guard-shell',
          pluginId: 'guard',
          sourcePath: pluginSourcePath,
          type: 'command',
        }],
      }],
      state,
    },
    permissionProfile: 'workspace-write',
    providers: [],
    setsunaStyle: 'developer',
    storagePath: '/tmp/setsuna/storage',
  };
}
