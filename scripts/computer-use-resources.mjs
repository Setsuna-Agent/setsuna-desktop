import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

/** Verify the native helper's actual executable architecture after packaging. */
export async function verifyComputerUseResources({ resourcesDir, platform, arch }) {
  if (!['darwin', 'win32'].includes(platform) || !['arm64', 'x64'].includes(arch)) throw new Error(`Unsupported computer-use target: ${platform}-${arch}`);
  if (platform === 'darwin') {
    if (!['arm64', 'x64'].includes(arch)) throw new Error(`Unsupported computer-use target: ${platform}-${arch}`);
    const binary = path.join(resourcesDir, 'computer-use', 'setsuna-computer');
    const license = path.join(resourcesDir, 'computer-use', 'LICENSE-background-computer-use');
    const bytes = await readFile(binary);
    const cpu = arch === 'arm64' ? 0x0100000c : 0x01000007;
    if (bytes.length < 8 || bytes.readUInt32LE(0) !== 0xfeedfacf || bytes.readUInt32LE(4) !== cpu) throw new Error(`Wrong computer helper architecture: ${arch}`);
    await access(license);
    return [binary, license];
  }
  const binary = path.join(resourcesDir, 'computer-use', 'setsuna-computer-win.exe');
  const bytes = await readFile(binary);
  const pe = bytes.length >= 64 ? bytes.readUInt32LE(60) : -1;
  if (pe < 64 || pe + 6 > bytes.length || bytes.readUInt16LE(0) !== 0x5a4d || bytes.readUInt32LE(pe) !== 0x4550
    || bytes.readUInt16LE(pe + 4) !== (arch === 'x64' ? 0x8664 : 0xaa64)) throw new Error(`Wrong Windows input helper architecture: ${arch}`);
  return [binary];
}
