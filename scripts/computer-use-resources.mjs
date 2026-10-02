import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

export const computerDriverVersion = '7.4.0';
export function computerNativeBinary(platform, arch) {
  if (!['darwin', 'win32'].includes(platform) || !['arm64', 'x64'].includes(arch)) throw new Error(`Unsupported computer-use target: ${platform}-${arch}`);
  return `computer-use-napi.${platform}-${arch}.node`;
}

/** Verify the actual packed host-only entry and native addon, never the MCP server. */
export async function verifyComputerUseResources({ resourcesDir, platform, arch }) {
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
  const root = path.join(resourcesDir, 'app.asar.unpacked', 'node_modules', '@zavora-ai/computer-use-mcp');
  const required = [
    path.join(resourcesDir, 'computer-use', 'driver-helper.mjs'),
    path.join(root, 'dist/native.js'),
    path.join(root, computerNativeBinary(platform, arch)),
    path.join(root, 'LICENSE'),
  ];
  await Promise.all(required.map((file) => access(file)));
  const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  if (manifest.version !== computerDriverVersion) throw new Error(`Computer driver version mismatch: ${manifest.version}`);
  return required;
}
