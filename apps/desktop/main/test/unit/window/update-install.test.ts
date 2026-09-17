import { EventEmitter } from 'node:events';
import type { BrowserWindow } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { DesktopUpdateInstallCoordinator } from '../../../src/window/update-install.js';

function windowFixture(dirty = false) {
  let destroyed = false;
  const window = Object.assign(new EventEmitter(), {
    webContents: new EventEmitter(),
    isDestroyed: () => destroyed,
    close: vi.fn(() => {
      const close = new Event('close', { cancelable: true });
      window.emit('close', close);
      if (close.defaultPrevented) return;
      if (dirty) {
        const unload = new Event('will-prevent-unload', { cancelable: true });
        window.webContents.emit('will-prevent-unload', unload);
        if (!unload.defaultPrevented) return;
      }
      destroyed = true;
      window.emit('closed');
    }),
  });
  return { window, browserWindow: window as unknown as BrowserWindow, save: () => { dirty = false; } };
}

function fixture(windows = [windowFixture()]) {
  const stopRuntime = vi.fn(async (): Promise<void> => undefined);
  const recover = vi.fn();
  const confirmDiscard = vi.fn(() => false);
  const quitAndInstall = vi.fn();
  const coordinator = new DesktopUpdateInstallCoordinator({
    getWindows: () => windows.filter(({ window }) => !window.isDestroyed()).map(({ browserWindow }) => browserWindow),
    stopRuntime, recover, confirmDiscard,
  });
  return { coordinator, stopRuntime, recover, confirmDiscard, quitAndInstall };
}

describe('update shutdown coordination', () => {
  it('keeps drafts and runtime available after cancellation, then permits saving and retrying', async () => {
    const draft = windowFixture(true);
    const { coordinator, stopRuntime, confirmDiscard, quitAndInstall } = fixture([draft]);
    expect(await coordinator.install(quitAndInstall)).toBe(false);
    expect(confirmDiscard).toHaveBeenCalledOnce();
    expect(draft.window.isDestroyed()).toBe(false);
    expect(stopRuntime).not.toHaveBeenCalled();
    expect(quitAndInstall).not.toHaveBeenCalled();
    expect(coordinator.active).toBe(false);
    expect(draft.window.webContents.listenerCount('will-prevent-unload')).toBe(0);

    draft.save();
    expect(await coordinator.install(quitAndInstall)).toBe(true);
    expect(draft.window.isDestroyed()).toBe(true);
    expect(stopRuntime).toHaveBeenCalledOnce();
    expect(quitAndInstall).toHaveBeenCalledOnce();
  });

  it('allows explicit discard, waits for all windows and runtime exit, then hands off to Squirrel', async () => {
    const windows = [windowFixture(true), windowFixture()];
    const { coordinator, stopRuntime, confirmDiscard, quitAndInstall } = fixture(windows);
    confirmDiscard.mockReturnValue(true);
    let finishStop!: () => void;
    stopRuntime.mockImplementation(() => {
      expect(windows.every(({ window }) => window.isDestroyed())).toBe(true);
      return new Promise<void>((resolve) => { finishStop = resolve; });
    });
    const installation = coordinator.install(quitAndInstall);
    await vi.waitFor(() => expect(stopRuntime).toHaveBeenCalledOnce());
    expect(coordinator.active).toBe(true);
    expect(quitAndInstall).not.toHaveBeenCalled();
    finishStop();
    expect(await installation).toBe(true);
    expect(quitAndInstall).toHaveBeenCalledOnce();
    expect(coordinator.active).toBe(true); // Suppress ordinary window shutdown until native handoff.
  });

  it('honors a main-process close veto without stopping runtime or arming native installation', async () => {
    const window = windowFixture();
    window.window.on('close', (event: Event) => event.preventDefault());
    const { coordinator, stopRuntime, quitAndInstall } = fixture([window]);
    expect(await coordinator.install(quitAndInstall)).toBe(false);
    expect(stopRuntime).not.toHaveBeenCalled();
    expect(quitAndInstall).not.toHaveBeenCalled();
    expect(coordinator.active).toBe(false);
  });

  it.each(['runtime', 'native'] as const)('restores the app after a %s failure following window closure', async (failure) => {
    const { coordinator, stopRuntime, recover, quitAndInstall } = fixture();
    if (failure === 'runtime') stopRuntime.mockRejectedValueOnce(new Error('Shutdown failed'));
    else quitAndInstall.mockImplementationOnce(() => { throw new Error('Install failed'); });
    await expect(coordinator.install(quitAndInstall)).rejects.toThrow(/failed/);
    expect(coordinator.active).toBe(false);
    expect(recover).toHaveBeenCalledOnce();
    if (failure === 'runtime') expect(quitAndInstall).not.toHaveBeenCalled();
  });

  it('recovers once when native installation emits an asynchronous error after handoff', async () => {
    const { coordinator, recover, quitAndInstall } = fixture();
    await coordinator.install(quitAndInstall);
    coordinator.recover();
    coordinator.recover();
    expect(coordinator.active).toBe(false);
    expect(recover).toHaveBeenCalledOnce();
  });
});
