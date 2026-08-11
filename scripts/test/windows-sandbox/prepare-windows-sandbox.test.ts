// @ts-nocheck -- Build scripts are native ESM and intentionally ship without declaration files.
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
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
