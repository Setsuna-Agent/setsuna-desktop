import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  installDesktopRipgrepEnvironment,
  installDesktopWindowsSandboxEnvironment,
  resolveDesktopRipgrep,
  resolveDesktopWindowsSandbox,
} from '../../../src/runtime/bundled-tools.js';

describe('bundled desktop tools', () => {
  it('resolves packaged rg from resources even when the system PATH is empty', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-bundled-rg-'));
    const resourcesPath = path.join(root, 'resources');
    const binaryPath = path.join(resourcesPath, 'setsuna-path', 'rg');
    await mkdir(path.dirname(binaryPath), { recursive: true });
    await writeFile(binaryPath, '#!/bin/sh\n');
    await chmod(binaryPath, 0o755);

    expect(resolveDesktopRipgrep({
      appRoot: path.join(resourcesPath, 'app.asar'),
      env: { PATH: '' },
      isPackaged: true,
      platform: 'darwin',
      resourcesPath,
    })).toBe(binaryPath);
  });

  it('does not fall back to a system rg when the packaged sidecar is missing', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-missing-rg-'));

    expect(() => resolveDesktopRipgrep({
      appRoot: path.join(root, 'app.asar'),
      env: { PATH: '/Applications/ChatGPT.app/Contents/Resources' },
      isPackaged: true,
      platform: 'darwin',
      resourcesPath: root,
    })).toThrow('missing or invalid');
  });

  it('rejects a relative development override', () => {
    expect(() => resolveDesktopRipgrep({
      appRoot: '/workspace',
      env: { SETSUNA_DESKTOP_RG_PATH: 'tools/rg' },
      isPackaged: false,
      platform: 'darwin',
    })).toThrow('must be an absolute path');
  });

  it('installs an explicit path for internal search and PATH lookup', () => {
    const env: NodeJS.ProcessEnv = { PATH: '/usr/bin' };
    const binaryPath = '/opt/setsuna/setsuna-path/rg';

    installDesktopRipgrepEnvironment(env, binaryPath, { required: true });

    expect(env.SETSUNA_DESKTOP_RG_PATH).toBe(binaryPath);
    expect(env.SETSUNA_DESKTOP_REQUIRE_BUNDLED_RG).toBe('1');
    expect(String(env.PATH).split(path.delimiter)[0]).toBe(path.dirname(binaryPath));
  });

  it('resolves the packaged Windows sandbox only from its bundled resource', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-windows-sandbox-'));
    const binaryPath = path.join(root, 'setsuna-sandbox', 'setsuna-sandbox-win.exe');
    await mkdir(path.dirname(binaryPath), { recursive: true });
    await writeFile(binaryPath, 'test sidecar');

    expect(resolveDesktopWindowsSandbox({
      appRoot: path.join(root, 'app.asar'),
      arch: 'x64',
      env: { PATH: '' },
      isPackaged: true,
      platform: 'win32',
      resourcesPath: root,
    })).toBe(binaryPath);
  });

  it('reports the Windows sandbox when its packaged resource is missing', () => {
    expect(() => resolveDesktopWindowsSandbox({
      appRoot: '/missing/app.asar',
      arch: 'x64',
      env: { PATH: '' },
      isPackaged: true,
      platform: 'win32',
      resourcesPath: '/missing',
    })).toThrow('Bundled Windows sandbox executable is missing or invalid');
  });

  it('installs and removes the explicit Windows sandbox path', () => {
    const env: NodeJS.ProcessEnv = {};

    installDesktopWindowsSandboxEnvironment(env, 'C:\\Setsuna\\setsuna-sandbox-win.exe', {
      required: true,
    });
    expect(env.SETSUNA_DESKTOP_WINDOWS_SANDBOX_PATH).toBe(
      'C:\\Setsuna\\setsuna-sandbox-win.exe',
    );

    installDesktopWindowsSandboxEnvironment(env, undefined, { required: false });
    expect(env.SETSUNA_DESKTOP_WINDOWS_SANDBOX_PATH).toBeUndefined();
  });
});
