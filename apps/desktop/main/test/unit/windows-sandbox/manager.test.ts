import { describe, expect, it, vi } from 'vitest';
import { WindowsSandboxManager } from '../../../src/windows-sandbox/manager.js';

describe('WindowsSandboxManager', () => {
  it('reports unsupported and missing-sidecar states without starting a process', async () => {
    const runSidecar = vi.fn(async () => '');
    const unsupported = new WindowsSandboxManager({
      architecture: 'arm64',
      executablePath: 'C:\\setsuna-sandbox-win.exe',
      platform: 'win32',
      runSidecar,
    });
    const unavailable = new WindowsSandboxManager({
      architecture: 'x64',
      platform: 'win32',
      runSidecar,
    });

    await expect(unsupported.getStatus()).resolves.toMatchObject({
      installSupported: false,
      state: 'unsupported',
    });
    await expect(unavailable.getStatus()).resolves.toMatchObject({
      installSupported: false,
      state: 'unavailable',
    });
    expect(runSidecar).not.toHaveBeenCalled();
  });

  it('normalizes status output and returns the post-action status', async () => {
    const runSidecar = vi.fn(async (command: string) => JSON.stringify({
      ok: command === 'install',
      status: {
        installSupported: true,
        installedVersion: command === 'install' ? '0.1.0' : undefined,
        platform: 'windows',
        protocolVersion: 1,
        reason: command === 'install' ? '' : 'not installed',
        sidecarVersion: '0.1.0',
        state: command === 'install' ? 'ready' : 'not-installed',
      },
    }));
    const manager = new WindowsSandboxManager({
      architecture: 'x64',
      executablePath: 'C:\\setsuna-sandbox-win.exe',
      platform: 'win32',
      runSidecar,
    });

    await expect(manager.getStatus()).resolves.toMatchObject({ state: 'not-installed' });
    await expect(manager.runAction('install')).resolves.toEqual({
      architecture: 'x64',
      installSupported: true,
      installedVersion: '0.1.0',
      platform: 'windows',
      protocolVersion: 1,
      reason: '',
      sidecarVersion: '0.1.0',
      state: 'ready',
    });
    expect(runSidecar.mock.calls.map(([command]) => command)).toEqual(['status', 'install']);
  });

  it('serializes elevated lifecycle actions', async () => {
    let release: (() => void) | undefined;
    const runSidecar = vi.fn(() => new Promise<string>((resolve) => {
      release = () => resolve(JSON.stringify({
        status: {
          installSupported: true,
          platform: 'windows',
          protocolVersion: 1,
          reason: '',
          state: 'ready',
        },
      }));
    }));
    const manager = new WindowsSandboxManager({
      architecture: 'x64',
      executablePath: 'C:\\setsuna-sandbox-win.exe',
      platform: 'win32',
      runSidecar,
    });

    const installing = manager.runAction('install');
    await expect(manager.runAction('repair')).rejects.toThrow('already in progress');
    release?.();
    await expect(installing).resolves.toMatchObject({ state: 'ready' });
  });

  it('reports an incompatible sidecar as needing repair', async () => {
    const manager = new WindowsSandboxManager({
      architecture: 'x64',
      executablePath: 'C:\\setsuna-sandbox-win.exe',
      platform: 'win32',
      runSidecar: async () => JSON.stringify({
        status: {
          installSupported: true,
          platform: 'windows',
          protocolVersion: 99,
          reason: '',
          state: 'ready',
        },
      }),
    });

    await expect(manager.getStatus()).resolves.toMatchObject({
      reason: expect.stringContaining('protocol mismatch'),
      state: 'needs-repair',
    });
  });
});
