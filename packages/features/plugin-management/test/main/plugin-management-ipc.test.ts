import { createFeatureScope } from '@setsuna-desktop/feature-core/scope';
import { afterEach, describe, expect, it, vi } from 'vitest';

const electronMocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      electronMocks.handlers.set(channel, handler);
    }),
    removeHandler: vi.fn((channel: string) => {
      electronMocks.handlers.delete(channel);
    }),
  },
}));

import { PLUGIN_MANAGEMENT_IPC_CHANNELS } from '../../src/contracts/index.js';
import type { PluginManagementMainHost } from '../../src/main/index.js';
import { registerPluginManagementIpc } from '../../src/main/ipc.js';

afterEach(() => {
  electronMocks.handlers.clear();
  vi.clearAllMocks();
});

describe('plugin management IPC', () => {
  it('keeps local paths behind the trusted renderer picker and Feature lifecycle', async () => {
    const installLocal = vi.fn(async () => ({ plugin: { id: 'local' } }));
    const selectLocalBundle = vi.fn(async () => '/tmp/local-plugin');
    const host = {
      installLocal,
      interfaceLanguage: () => 'zh-CN',
      isRendererSender: (senderId: number) => senderId === 7,
      selectLocalBundle,
    } as unknown as PluginManagementMainHost;
    const scope = createFeatureScope({
      featureId: 'plugin-management',
      process: 'main',
      scopeId: 'plugin-management-main-test',
    });
    scope.scope.add(registerPluginManagementIpc(scope.scope, host));
    scope.activate();
    const install = ipcHandler(PLUGIN_MANAGEMENT_IPC_CHANNELS.installLocal);

    await expect(install({ sender: { id: 6 } })).resolves.toBeNull();
    expect(selectLocalBundle).not.toHaveBeenCalled();
    await expect(install({ sender: { id: 7 } })).resolves.toMatchObject({
      plugin: { id: 'local' },
    });
    expect(selectLocalBundle).toHaveBeenCalledWith('选择本地插件目录');
    expect(installLocal).toHaveBeenCalledWith('/tmp/local-plugin');

    await scope.finishDispose();
    expect(electronMocks.handlers.has(PLUGIN_MANAGEMENT_IPC_CHANNELS.installLocal)).toBe(false);
  });
});

function ipcHandler(channel: string): (...args: unknown[]) => Promise<unknown> {
  const handler = electronMocks.handlers.get(channel);
  if (!handler) throw new Error(`Missing IPC handler: ${channel}`);
  return async (...args: unknown[]) => handler(...args);
}
