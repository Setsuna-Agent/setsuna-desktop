import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error Build helpers are native ESM scripts.
import { verifyComputerUseResources } from '../computer-use-resources.mjs';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
describe('computer-use packaged resources', () => {
  it.each([['win32', 'x64'], ['win32', 'arm64']])('requires a Windows helper matching %s-%s', async (platform, arch) => {
    const resourcesDir = await mkdtemp(path.join(os.tmpdir(), 'computer-resources-')); roots.push(resourcesDir);
    const directory = path.join(resourcesDir, 'computer-use'); await mkdir(directory);
    const bytes = Buffer.alloc(128); bytes.writeUInt16LE(0x5a4d, 0); bytes.writeUInt32LE(64, 60);
    bytes.writeUInt32LE(0x4550, 64); bytes.writeUInt16LE(arch === 'x64' ? 0x8664 : 0xaa64, 68);
    await writeFile(path.join(directory, 'setsuna-computer-win.exe'), bytes);
    await expect(verifyComputerUseResources({ resourcesDir, platform, arch })).resolves.toHaveLength(1);
    await expect(verifyComputerUseResources({ resourcesDir, platform, arch: arch === 'x64' ? 'arm64' : 'x64' })).rejects.toThrow('architecture');
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
  it('rejects unsupported platforms and architectures', async () => {
    await expect(verifyComputerUseResources({ platform: 'linux', arch: 'x64' })).rejects.toThrow();
    await expect(verifyComputerUseResources({ platform: 'win32', arch: 'ia32' })).rejects.toThrow();
  });
});
