import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearWindowsNativeSandboxCapabilityCache,
  windowsNativeSandboxCapability,
  writeWindowsSandboxRequest,
} from '../../../../src/adapters/sandbox/windows-native/windows-native-sandbox.js';

afterEach(() => clearWindowsNativeSandboxCapabilityCache());

describe('Windows native sandbox adapter', () => {
  it('accepts only a ready matching sidecar and caches the short status probe', () => {
    const probe = vi.fn(() => ({
      executablePath: 'C:\\setsuna-sandbox-win.exe',
      provider: 'windows-native' as const,
      reason: '',
      supported: true,
    }));
    const options = {
      env: { SETSUNA_DESKTOP_WINDOWS_SANDBOX_PATH: 'C:\\setsuna-sandbox-win.exe' },
      now: 1_000,
      platform: 'win32',
      probe,
    };

    expect(windowsNativeSandboxCapability(options)).toMatchObject({ supported: true });
    expect(windowsNativeSandboxCapability({ ...options, now: 2_000 })).toMatchObject({ supported: true });
    expect(probe).toHaveBeenCalledOnce();
  });

  it('does not cache a not-installed probe across a completed settings action', () => {
    const probe = vi.fn()
      .mockReturnValueOnce({ provider: '', reason: 'not installed', supported: false })
      .mockReturnValueOnce({
        executablePath: 'C:\\setsuna-sandbox-win.exe',
        provider: 'windows-native',
        reason: '',
        supported: true,
      });
    const options = {
      env: { SETSUNA_DESKTOP_WINDOWS_SANDBOX_PATH: 'C:\\setsuna-sandbox-win.exe' },
      now: 1_000,
      platform: 'win32',
      probe,
    };

    expect(windowsNativeSandboxCapability(options)).toMatchObject({ supported: false });
    expect(windowsNativeSandboxCapability(options)).toMatchObject({ supported: true });
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('writes the versioned request consumed by the sidecar', async () => {
    const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'setsuna-windows-request-'));
    const requestPath = await writeWindowsSandboxRequest('echo hello', {
      cwd: temporaryRoot,
      deniedGlobRegExpSources: [],
      deniedRoots: [],
      environment: { HTTP_PROXY: 'http://sandbox:secret@127.0.0.1:61080' },
      networkAccess: true,
      permissionProfile: 'workspace-write',
      protectedWritableRoots: [],
      provider: 'windows-native',
      providerExecutable: 'C:\\setsuna-sandbox-win.exe',
      readableRoots: [temporaryRoot],
      workspaceRoot: temporaryRoot,
      writableRoots: [temporaryRoot],
    }, 'execution_1', temporaryRoot);

    await expect(readFile(requestPath, 'utf8').then(JSON.parse)).resolves.toMatchObject({
      command: 'echo hello',
      executionId: 'execution_1',
      networkAccess: true,
      protocolVersion: 1,
      permissionProfile: 'workspace-write',
      supervisorPids: expect.arrayContaining([process.pid]),
    });
  });
});
