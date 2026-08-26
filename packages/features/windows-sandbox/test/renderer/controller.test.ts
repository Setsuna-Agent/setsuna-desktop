import type { DesktopWindowsSandboxStatus } from '../../src/contracts/index.js';
import { describe, expect, it, vi } from 'vitest';
import { runWindowsSandboxActionAndReconcile } from '../../src/renderer/controller.js';

const notInstalled: DesktopWindowsSandboxStatus = {
  architecture: 'x64',
  installSupported: true,
  platform: 'win32',
  reason: 'Windows native sandbox is not installed',
  state: 'not-installed',
};

const needsRepair: DesktopWindowsSandboxStatus = {
  ...notInstalled,
  installedVersion: '0.1.0',
  reason: 'Windows sandbox installation needs repair',
  state: 'needs-repair',
};

describe('runWindowsSandboxActionAndReconcile', () => {
  it('refreshes status when an elevated action commits before validation fails', async () => {
    const getStatus = vi.fn(async () => needsRepair);
    const runAction = vi.fn(async () => {
      throw new Error('post-install validation failed');
    });

    await expect(runWindowsSandboxActionAndReconcile(
      { getStatus, runAction },
      'install',
    )).resolves.toEqual({
      error: 'post-install validation failed',
      status: needsRepair,
    });
    expect(getStatus).toHaveBeenCalledOnce();
  });

  it('clears a transport error when refreshed state proves uninstall completed', async () => {
    const getStatus = vi.fn(async () => notInstalled);
    const runAction = vi.fn(async () => {
      throw new Error('IPC response was lost');
    });

    await expect(runWindowsSandboxActionAndReconcile(
      { getStatus, runAction },
      'uninstall',
    )).resolves.toEqual({ error: null, status: notInstalled });
  });
});
