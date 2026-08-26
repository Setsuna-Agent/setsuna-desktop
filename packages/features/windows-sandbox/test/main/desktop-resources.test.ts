import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  installWindowsSandboxRuntimeEnvironment,
  resolveDesktopSandboxCurl,
  resolveDesktopWindowsSandbox,
} from '../../src/main/desktop-resources.js';

describe('Windows sandbox desktop resources', () => {
  it('resolves the packaged sidecar only from its bundled resource', async () => {
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

  it('fails closed when packaged resources or trust files are missing', async () => {
    expect(() => resolveDesktopWindowsSandbox({
      appRoot: '/missing/app.asar',
      arch: 'x64',
      isPackaged: true,
      platform: 'win32',
      resourcesPath: '/missing',
    })).toThrow('Bundled Windows sandbox executable is missing or invalid');

    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-sandbox-curl-'));
    const binaryPath = path.join(root, 'setsuna-path', 'curl.exe');
    await mkdir(path.dirname(binaryPath), { recursive: true });
    await Promise.all([
      writeFile(binaryPath, 'test curl'),
      writeFile(path.join(path.dirname(binaryPath), 'curl-ca-bundle.crt'), 'test CA bundle'),
      writeFile(path.join(path.dirname(binaryPath), '_curlrc'), 'ca-native\n'),
    ]);
    expect(resolveDesktopSandboxCurl({
      appRoot: path.join(root, 'app.asar'),
      arch: 'x64',
      isPackaged: true,
      platform: 'win32',
      resourcesPath: root,
    })).toBe(binaryPath);

    await rm(path.join(path.dirname(binaryPath), 'curl-ca-bundle.crt'));
    expect(() => resolveDesktopSandboxCurl({
      appRoot: path.join(root, 'app.asar'),
      arch: 'x64',
      isPackaged: true,
      platform: 'win32',
      resourcesPath: root,
    })).toThrow('CA bundle is missing or invalid');
  });

  it('installs the absolute runtime paths and fails closed for incomplete packaged input', () => {
    const env: NodeJS.ProcessEnv = {};
    installWindowsSandboxRuntimeEnvironment(env, {
      executablePath: 'C:\\Setsuna\\setsuna-sandbox-win.exe',
      hostPid: 42,
      required: true,
      sandboxCaBundlePath: 'C:\\Setsuna\\sandbox-trust\\curl-ca-bundle.pem',
      sandboxCurlPath: 'C:\\Setsuna\\setsuna-path\\curl.exe',
    });

    expect(env).toMatchObject({
      SETSUNA_DESKTOP_HOST_PID: '42',
      SETSUNA_DESKTOP_SANDBOX_CA_BUNDLE: 'C:\\Setsuna\\sandbox-trust\\curl-ca-bundle.pem',
      SETSUNA_DESKTOP_SANDBOX_CURL_PATH: 'C:\\Setsuna\\setsuna-path\\curl.exe',
      SETSUNA_DESKTOP_WINDOWS_SANDBOX_PATH: 'C:\\Setsuna\\setsuna-sandbox-win.exe',
    });
    expect(() => installWindowsSandboxRuntimeEnvironment({}, {
      hostPid: 42,
      required: true,
    })).toThrow('Bundled Windows sandbox is required');
  });
});
