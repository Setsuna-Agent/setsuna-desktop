import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { provideHostCapability, requiredCapability } from '@setsuna-desktop/feature-core/capability';
import { defineMainFeatureHost } from '@setsuna-desktop/feature-core/main';
import { computerConnectionCapability, computerMainFeature, computerMainHostCapability, computerMainLifecycleCapability } from '../../src/main/feature.js';
import { computerUseChannels } from '../../src/contracts/index.js';
import { ComputerControlClient } from '../../src/runtime/control-client.js';
import { ComputerRuntimeTools } from '../../src/runtime/tools.js';

const native = vi.hoisted(() => {
  const window = { id: '8:12:4000', pid: 8, windowNumber: 12, application: 'Fixture', title: 'Document', bounds: { x: 100, y: 100, width: 1, height: 1 } };
  const target = { scope: 'window' as const, window };
  return {
    directory: '',
    handlers: new Map<string, (...args: unknown[]) => unknown>(),
    stopShortcut: undefined as ((reason: string) => void) | undefined,
    backend: {
      start: vi.fn(async () => target),
      capture: vi.fn(async () => ({ ...target, width: 1, height: 1, size: 3, dataUrl: 'data:image/png;base64,YWJj', capture: { backend: 'macos-window', sourceWindowId: window.id } })),
      stop: vi.fn(async () => undefined),
    },
  };
});

// Keep the real feature, IPC handlers and HTTP control path. Only the OS boundary
// is synthetic, so a stop test cannot capture the desktop or dispatch input.
vi.mock('electron', () => ({
  app: { getPath: () => native.directory, getAppPath: () => native.directory, isPackaged: false },
  ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => native.handlers.set(channel, handler), removeHandler: (channel: string) => native.handlers.delete(channel) },
  powerMonitor: { on: vi.fn(), off: vi.fn() },
  screen: { on: vi.fn(), off: vi.fn() },
}));
vi.mock('../../src/main/permissions.js', () => ({
  computerPermissions: () => ({ screen: 'granted', accessibility: 'granted' }),
  requestComputerPermission: vi.fn(),
}));
vi.mock('../../src/main/supervisor.js', () => ({ NativeComputerSupervisor: class {
  checkPermissions() {}
  async registerStop(stop: (reason: string) => void) { native.stopShortcut = stop; }
  unregisterStop() { native.stopShortcut = undefined; }
  async showControl() {}
  prepareInput() {}
} }));
vi.mock('../../src/main/window-backend.js', () => ({ MacWindowBackend: class { constructor() { return native.backend; } } }));
vi.mock('../../src/main/backend.js', async (original) => ({
  ...await original<typeof import('../../src/main/backend.js')>(),
  DesktopComputerBackend: class { constructor() { return native.backend; } },
}));

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.clearAllMocks();
});

async function fixture() {
  native.directory = await mkdtemp(path.join(os.tmpdir(), 'setsuna-computer-stop-'));
  const directory = native.directory;
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const cancelTurn = vi.fn(async () => undefined);
  const composition = await defineMainFeatureHost({ required: [computerMainFeature], optional: [] }).activate({
    hostCapabilities: [provideHostCapability(computerMainHostCapability, { isAllowedSender: (id) => id === 7, interfaceLanguage: () => 'zh-CN', writeJsonAtomically: async () => undefined, cancelTurn })],
  });
  cleanups.push(() => composition.dispose());
  const frame = {};
  const event = { sender: { id: 7, mainFrame: frame }, senderFrame: frame };
  const invoke = (channel: string, ...args: unknown[]) => native.handlers.get(channel)!(event, ...args);
  await invoke(computerUseChannels.setEnabled, true);
  const { connection, lifecycle } = composition.resolveHostDependencies({ connection: requiredCapability(computerConnectionCapability), lifecycle: requiredCapability(computerMainLifecycleCapability) });
  const tools = new ComputerRuntimeTools(new ComputerControlClient(connection.url, connection.token));
  const context = { threadId: 'owner-thread', turnId: 'owner-turn', modelCapabilities: { supportsImages: true } };
  return { cancelTurn, invoke, tools, context, lifecycle };
}

describe('main feature session lifecycle', () => {
  it.each(['preview', 'shortcut', 'settings'] as const)('%s cancels the owning turn and prevents its restart', async (source) => {
    const { cancelTurn, invoke, tools, context } = await fixture();
    await tools.runTool('computer_start', { windowId: '8:12:4000' }, context);

    if (source === 'preview') await invoke(computerUseChannels.stop);
    else if (source === 'shortcut') native.stopShortcut!('emergency-shortcut');
    else await invoke(computerUseChannels.setEnabled, false);
    await vi.waitFor(() => expect(native.backend.stop).toHaveBeenCalledOnce());
    expect(cancelTurn).toHaveBeenCalledExactlyOnceWith(context.threadId, context.turnId);
    expect(await invoke(computerUseChannels.status)).toMatchObject({ active: false });

    await tools.cleanupTurn(context);
    if (source === 'settings') await invoke(computerUseChannels.setEnabled, true);
    await expect(tools.runTool('computer_start', { windowId: '8:12:4000' }, context)).rejects.toThrow('stopped by the user');
    expect(native.backend.start).toHaveBeenCalledOnce();
    await tools.runTool('computer_start', { windowId: '8:12:4000' }, { ...context, turnId: 'next-user-turn' });
    await tools.runTool('computer_stop', {}, { ...context, turnId: 'next-user-turn' });
    expect(cancelTurn).toHaveBeenCalledOnce();
  });

  it('clears an idle session and its preview on runtime exit, allowing a replacement runtime to start', async () => {
    const { cancelTurn, invoke, tools, context, lifecycle } = await fixture();
    await tools.runTool('computer_start', { windowId: '8:12:4000' }, context);
    expect(await invoke(computerUseChannels.status)).toMatchObject({ active: true });
    // The start response is already complete: no HTTP disconnect can revoke it.
    const stopped = lifecycle.runtimeExited();
    expect(await invoke(computerUseChannels.preview)).toEqual({ active: false, frame: null });
    await stopped;
    expect(native.backend.stop).toHaveBeenCalledOnce();
    expect(native.stopShortcut).toBeUndefined();
    expect(cancelTurn).not.toHaveBeenCalled();
    await expect(tools.runTool('computer_start', { windowId: '8:12:4000' }, { ...context, turnId: 'replacement-runtime-turn' })).resolves.toHaveProperty('attachments');
    expect(native.backend.start).toHaveBeenCalledTimes(2);
  });
});
