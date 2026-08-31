import { realpathSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearWindowsNativeSandboxCapabilityCache,
  WindowsNativeSandboxService,
  windowsSandboxDefaultReadableRoots,
  windowsNativeSandboxCapability,
  writeWindowsSandboxRequest,
} from '../../src/runtime/windows-native-sandbox.js';

afterEach(() => {
  clearWindowsNativeSandboxCapabilityCache();
  vi.unstubAllEnvs();
});

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
    const requestPath = await writeWindowsSandboxRequest({
      command: 'echo hello',
      controlRoot: temporaryRoot,
      cwd: temporaryRoot,
      deniedGlobRegExpSources: [],
      deniedRoots: [],
      environment: { HTTP_PROXY: 'http://sandbox:secret@127.0.0.1:61080' },
      ephemeralWritableRoots: [temporaryRoot],
      networkAccess: true,
      permissionProfile: 'workspace-write',
      protectedWritableRoots: [],
      providerExecutable: 'C:\\setsuna-sandbox-win.exe',
      readableRoots: [temporaryRoot],
      workspaceRoot: temporaryRoot,
      writableRoots: [temporaryRoot],
      executionId: 'execution_1',
    });

    await expect(readFile(requestPath, 'utf8').then(JSON.parse)).resolves.toMatchObject({
      command: 'echo hello',
      executionId: 'execution_1',
      ephemeralWritableRoots: [temporaryRoot],
      networkAccess: true,
      protocolVersion: 1,
      permissionProfile: 'workspace-write',
      supervisorPids: expect.arrayContaining([process.pid]),
    });
  });

  it('prepares the sandbox-only curl environment and readable trust files', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-windows-curl-'));
    const curlDirectory = path.join(root, 'setsuna-path');
    const curlExecutable = path.join(curlDirectory, 'curl.exe');
    const curlConfig = path.join(curlDirectory, '_curlrc');
    const trustBundle = path.join(root, 'sandbox-trust', 'curl-ca-bundle.pem');
    await Promise.all([
      mkdir(curlDirectory, { recursive: true }),
      mkdir(path.dirname(trustBundle), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(curlExecutable, 'curl'),
      writeFile(curlConfig, 'ca-native'),
      writeFile(trustBundle, 'public CA material'),
    ]);
    vi.stubEnv('SETSUNA_DESKTOP_SANDBOX_CURL_PATH', curlExecutable);
    vi.stubEnv('SETSUNA_DESKTOP_SANDBOX_CA_BUNDLE', trustBundle);
    vi.stubEnv('SystemRoot', '');
    vi.stubEnv('WINDIR', '');
    vi.stubEnv('ProgramFiles', '');
    vi.stubEnv('ProgramFiles(x86)', '');
    vi.stubEnv('ProgramData', '');
    vi.stubEnv('USERPROFILE', '');

    const prepared = new WindowsNativeSandboxService().prepareEnvironment({
      PATH: path.join(root, 'system-bin'),
    });

    expect(prepared.environment).toMatchObject({
      CURL_CA_BUNDLE: trustBundle,
      CURL_HOME: curlDirectory,
    });
    expect(prepared.environment.PATH?.split(path.delimiter)[0]).toBe(curlDirectory);
    expect(prepared.readableRoots).toEqual([curlExecutable, trustBundle, curlConfig]);
  });

  it('grants the Codex-style Windows read baseline without exposing credentials or Setsuna state', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-windows-read-roots-'));
    const systemRoot = path.join(root, 'Windows');
    const programFiles = path.join(root, 'Program Files');
    const programFilesX86 = path.join(root, 'Program Files (x86)');
    const programData = path.join(root, 'ProgramData');
    const profileRoot = path.join(root, 'User');
    const documents = path.join(profileRoot, 'Documents');
    const ssh = path.join(profileRoot, '.ssh');
    const codex = path.join(profileRoot, '.codex');
    const localPrograms = path.join(profileRoot, 'AppData', 'Local', 'Programs');
    const roamingPnpm = path.join(profileRoot, 'AppData', 'Roaming', 'pnpm');
    const dataRoot = path.join(profileRoot, 'AppData', 'Roaming', 'Setsuna Desktop');
    await Promise.all([
      systemRoot,
      programFiles,
      programFilesX86,
      programData,
      documents,
      ssh,
      codex,
      localPrograms,
      roamingPnpm,
      dataRoot,
    ].map((directory) => mkdir(directory, { recursive: true })));

    const readableRoots = windowsSandboxDefaultReadableRoots({
      ProgramData: programData,
      ProgramFiles: programFiles,
      'ProgramFiles(x86)': programFilesX86,
      SETSUNA_DESKTOP_DATA_DIR: dataRoot,
      SystemRoot: systemRoot,
      USERPROFILE: profileRoot,
    });

    const expectedReadableRoots = [
      systemRoot,
      programFiles,
      programFilesX86,
      programData,
      documents,
      path.dirname(localPrograms),
      roamingPnpm,
    ].map((candidate) => realpathSync.native(candidate));

    expect(readableRoots).toEqual(expect.arrayContaining(expectedReadableRoots));
    for (const protectedRoot of [
      profileRoot,
      path.join(profileRoot, 'AppData'),
      path.dirname(dataRoot),
      dataRoot,
      ssh,
      codex,
    ]) {
      expect(readableRoots).not.toContain(realpathSync.native(protectedRoot));
    }
  });

  it.skipIf(process.platform !== 'win32')('rejects profile Junctions that resolve outside the user profile', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-windows-profile-junction-'));
    const profileRoot = path.join(root, 'User');
    const externalRoot = path.join(root, 'ExternalTools');
    const linkedTools = path.join(profileRoot, 'Tools');
    await Promise.all([
      mkdir(profileRoot, { recursive: true }),
      mkdir(externalRoot, { recursive: true }),
    ]);
    await symlink(externalRoot, linkedTools, 'junction');

    const readableRoots = windowsSandboxDefaultReadableRoots({ USERPROFILE: profileRoot });

    expect(readableRoots).not.toContain(linkedTools);
    expect(readableRoots).not.toContain(await realpath(externalRoot));
  });
});
