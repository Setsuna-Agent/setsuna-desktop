import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error Build helpers are native ESM scripts.
import { computerNativeBinary, verifyComputerUseResources } from '../computer-use-resources.mjs';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
describe('computer-use packaged resources', () => {
  it.each([['win32', 'x64'], ['win32', 'arm64']])('requires helper, pinned host entry and native addon for %s-%s', async (platform, arch) => {
    const resourcesDir = await mkdtemp(path.join(os.tmpdir(), 'computer-resources-')); roots.push(resourcesDir);
    const root = path.join(resourcesDir, 'app.asar.unpacked/node_modules/@zavora-ai/computer-use-mcp'); const native = computerNativeBinary(platform, arch);
    const files: Record<string, string> = {
      [path.join(resourcesDir, 'computer-use/driver-helper.mjs')]: '',
      [path.join(root, 'dist/native.js')]: '',
      [path.join(root, 'package.json')]: JSON.stringify({ version: '7.4.0' }),
      [path.join(root, 'LICENSE')]: '',
      [path.join(root, native)]: '',
    };
    for (const [file, value] of Object.entries(files)) { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, value); }
    await expect(verifyComputerUseResources({ resourcesDir, platform, arch })).resolves.toHaveLength(4);
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '0.31.0' }));
    await expect(verifyComputerUseResources({ resourcesDir, platform, arch })).rejects.toThrow('version mismatch');
  });
  it.each(['arm64', 'x64'])('requires the macOS window helper for the package architecture %s and its license', async (arch) => {
    const resourcesDir = await mkdtemp(path.join(os.tmpdir(), 'window-resources-')); roots.push(resourcesDir);
    const directory = path.join(resourcesDir, 'computer-use'); await mkdir(directory);
    const binary = path.join(directory, 'setsuna-computer');
    const license = path.join(directory, 'LICENSE-background-computer-use');
    const bytes = Buffer.alloc(8); bytes.writeUInt32LE(0xfeedfacf, 0); bytes.writeUInt32LE(arch === 'arm64' ? 0x0100000c : 0x01000007, 4);
    await writeFile(binary, bytes);
    await expect(verifyComputerUseResources({ resourcesDir, platform: 'darwin', arch })).rejects.toThrow();
    await writeFile(license, 'MIT');
    await expect(verifyComputerUseResources({ resourcesDir, platform: 'darwin', arch })).resolves.toEqual([binary, license]);
    await expect(verifyComputerUseResources({ resourcesDir, platform: 'darwin', arch: arch === 'arm64' ? 'x64' : 'arm64' })).rejects.toThrow('architecture');
  });
  it('rejects unsupported platforms and architectures', () => {
    expect(() => computerNativeBinary('linux', 'x64')).toThrow(); expect(() => computerNativeBinary('win32', 'ia32')).toThrow();
  });
});
