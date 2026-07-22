import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  installDesktopRipgrepEnvironment,
  resolveDesktopRipgrep,
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
});
