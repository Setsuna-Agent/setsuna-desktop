// @ts-nocheck -- Build scripts are native ESM and intentionally ship without declaration files.
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import packageJson from '../../../package.json';
import {
  downloadSandboxCurlArchive,
  verifyPreparedSandboxCurl,
} from '../../windows-sandbox/prepare-sandbox-curl.mjs';
import { verifyPreparedWindowsSandbox } from '../../windows-sandbox/prepare-windows-sandbox.mjs';

describe('prepared Windows sandbox verification', () => {
  it('accepts only the complete protocol-versioned sidecar bundle', async () => {
    const destination = await preparedBundle();

    await expect(verifyPreparedWindowsSandbox({
      destination,
      execute: false,
      version: '0.1.0',
    })).resolves.toMatchObject({
      binaryPath: path.join(destination, 'setsuna-sandbox-win.exe'),
      version: '0.1.0',
    });
  });

  it('rejects a bundle that omits its Apache license', async () => {
    const destination = await preparedBundle({ omitLicense: true });

    await expect(verifyPreparedWindowsSandbox({
      destination,
      execute: false,
    })).rejects.toThrow('file manifest is invalid');
  });
});

describe('prepared Windows sandbox curl verification', () => {
  it('verifies the complete LibreSSL curl bundle and package wiring', async () => {
    const destination = await preparedCurlBundle();

    await expect(verifyPreparedSandboxCurl({
      destination,
      execute: false,
    })).resolves.toMatchObject({
      binaryPath: path.join(destination, 'curl.exe'),
      version: '8.21.0',
    });
    expect(packageJson.build.win.extraResources).toContainEqual(expect.objectContaining({
      from: '.cache/sandbox-curl/win-x64',
      to: 'setsuna-path',
      filter: expect.arrayContaining([
        'curl.exe',
        'curl-ca-bundle.crt',
        '_curlrc',
        'LICENSE-CURL.txt',
        'THIRD-PARTY-LICENSES-CURL.txt',
        'curl-metadata.json',
      ]),
    }));
  });

  it('rejects curl files that differ from the post-pack manifest', async () => {
    const destination = await preparedCurlBundle();
    await writeFile(path.join(destination, 'curl.exe'), 'tampered');

    await expect(verifyPreparedSandboxCurl({
      destination,
      execute: false,
    })).rejects.toThrow('curl.exe');
  });
});

describe('Windows sandbox curl download', () => {
  it('retries transient failures inside the automatic dev preparation', async () => {
    const archive = Buffer.from('verified archive');
    const target = downloadTarget(archive);
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new Error('proxy connection reset'))
      .mockResolvedValueOnce(new Response(archive));
    const logger = { info: vi.fn(), warn: vi.fn() };
    const delayImpl = vi.fn(async () => undefined);

    const downloaded = await downloadSandboxCurlArchive(target, {
      delayImpl,
      fetchImpl,
      logger,
      retryDelaysMs: [25],
    });

    expect(downloaded.equals(archive)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(delayImpl).toHaveBeenCalledWith(25);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Retrying in 25 ms'));
  });

  it('reports the target and attempt count after retries are exhausted', async () => {
    const archive = Buffer.from('verified archive');
    const target = downloadTarget(archive);
    const fetchImpl = vi.fn().mockRejectedValue(new Error('proxy unavailable'));

    await expect(downloadSandboxCurlArchive(target, {
      delayImpl: async () => undefined,
      fetchImpl,
      logger: { info: vi.fn(), warn: vi.fn() },
      retryDelaysMs: [0, 0],
    })).rejects.toThrow(
      `Failed to download sandbox curl from ${target.url} after 3 attempts: proxy unavailable`,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('turns an aborted request into an actionable timeout error', async () => {
    const archive = Buffer.from('verified archive');
    const fetchImpl = vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    }));

    await expect(downloadSandboxCurlArchive(downloadTarget(archive), {
      fetchImpl,
      logger: { info: vi.fn(), warn: vi.fn() },
      retryDelaysMs: [],
      timeoutMs: 1,
    })).rejects.toThrow('Sandbox curl download timed out after 1 ms');
  });
});

async function preparedBundle(options: { omitLicense?: boolean } = {}): Promise<string> {
  const destination = await mkdtemp(path.join(tmpdir(), 'setsuna-prepared-sandbox-'));
  await mkdir(destination, { recursive: true });
  const files: Record<string, string> = {
    'setsuna-sandbox-win.exe': 'fake executable',
    'NOTICE.txt': 'notice',
    ...(options.omitLicense ? {} : { 'LICENSE-APACHE.txt': 'Apache License 2.0' }),
  };
  await Promise.all(Object.entries(files).map(([name, contents]) => (
    writeFile(path.join(destination, name), contents)
  )));
  await writeFile(path.join(destination, 'metadata.json'), `${JSON.stringify({
    schemaVersion: 1,
    name: 'setsuna-windows-sandbox',
    version: '0.1.0',
    protocolVersion: 1,
    target: 'x86_64-pc-windows-msvc',
    files: Object.fromEntries(Object.entries(files).map(([name, contents]) => [
      name,
      createHash('sha256').update(contents).digest('hex'),
    ])),
  })}\n`);
  return destination;
}

async function preparedCurlBundle(): Promise<string> {
  const destination = await mkdtemp(path.join(tmpdir(), 'setsuna-prepared-curl-'));
  const files: Record<string, string> = {
    'curl.exe': 'fake LibreSSL curl',
    'curl-ca-bundle.crt': 'fake CA bundle',
    '_curlrc': '# Use Windows trust anchors in addition to the bundled Mozilla CA file.\nca-native\n',
    'LICENSE-CURL.txt': 'curl license',
    'THIRD-PARTY-LICENSES-CURL.txt': 'third-party licenses',
    'NOTICE-CURL.txt': 'notice',
  };
  await Promise.all(Object.entries(files).map(([name, contents]) => (
    writeFile(path.join(destination, name), contents)
  )));
  await writeFile(path.join(destination, 'curl-metadata.json'), `${JSON.stringify({
    schemaVersion: 1,
    name: 'curl-for-win',
    version: '8.21.0',
    build: '8.21.0_5',
    tlsBackend: 'LibreSSL',
    trustMode: 'windows-native+mozilla-bundle',
    source: 'https://curl.se/windows/dl-8.21.0_5/curl-8.21.0_5-win64-mingw.zip',
    archiveSize: 8625821,
    archiveSha256: '4c48761e9b70f447af76e65564cf2afbbf626e4ea6286008fde5cc068de237fd',
    files: Object.fromEntries(Object.entries(files).map(([name, contents]) => [
      name,
      createHash('sha256').update(contents).digest('hex'),
    ])),
  })}\n`);
  return destination;
}

function downloadTarget(archive: Buffer) {
  return {
    archiveSha256: createHash('sha256').update(archive).digest('hex'),
    archiveSize: archive.length,
    url: 'https://example.test/sandbox-curl.zip',
  };
}
