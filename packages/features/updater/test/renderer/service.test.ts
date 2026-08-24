import { describe, expect, it, vi } from 'vitest';
import type {
  DesktopUpdateState,
  UpdaterDesktopBridge,
} from '../../src/contracts/index.js';
import { UpdaterRendererStateService } from '../../src/renderer/service.js';

describe('UpdaterRendererStateService', () => {
  it('keeps a pushed state when the initial snapshot arrives late and ignores pushes after disposal', async () => {
    const initial = deferred<DesktopUpdateState>();
    let pushState: ((state: DesktopUpdateState) => void) | null = null;
    const unsubscribe = vi.fn();
    const bridge = {
      getState: vi.fn(() => initial.promise),
      onStateChange: vi.fn((listener: (state: DesktopUpdateState) => void) => {
        pushState = listener;
        return unsubscribe;
      }),
      addDownloadSource: vi.fn(),
      checkForUpdates: vi.fn(),
      promptReadyUpdate: vi.fn(),
      quitAndInstall: vi.fn(),
      removeDownloadSource: vi.fn(),
      selectDownloadSource: vi.fn(),
    } as UpdaterDesktopBridge;
    const service = new UpdaterRendererStateService(bridge);
    service.start();

    const downloaded = updateState({ status: 'downloaded', downloadedVersion: 'v0.3.0' });
    pushState?.(downloaded);
    initial.resolve(updateState({ status: 'idle' }));
    await initial.promise;
    await Promise.resolve();

    expect(service.snapshot().state).toBe(downloaded);

    service.dispose();
    expect(unsubscribe).toHaveBeenCalledOnce();
    pushState?.(updateState({ status: 'error', error: 'late push' }));
    expect(service.snapshot().state).toBe(downloaded);
  });
});

function updateState(patch: Partial<DesktopUpdateState>): DesktopUpdateState {
  return {
    status: 'idle',
    currentVersion: '0.2.4',
    platform: 'darwin',
    arch: 'arm64',
    installMode: 'open-finder',
    canUpdate: true,
    feedUrl: 'https://github.com/Setsuna-Agent/setsuna-desktop/releases/latest',
    activeDownloadSourceId: 'github-direct',
    downloadSources: [{
      id: 'github-direct',
      name: 'GitHub Direct',
      urlTemplate: '{url}',
      builtIn: true,
    }],
    manualInstall: true,
    ...patch,
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
