import { execFile } from 'node:child_process';
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function buildWindowsComputerHelper({ arch = process.arch, projectDir = root } = {}) {
  if (process.platform !== 'win32' || !['x64', 'arm64'].includes(arch)) throw new Error(`Unsupported Windows input helper target: ${process.platform}-${arch}`);
  const crate = path.join(projectDir, 'native', 'computer-use-windows');
  const target = `${arch === 'x64' ? 'x86_64' : 'aarch64'}-pc-windows-msvc`;
  await execFileAsync('cargo', ['build', '--locked', '--release', '--manifest-path', path.join(crate, 'Cargo.toml'), '--target', target],
    { cwd: projectDir, windowsHide: true, timeout: 600_000 });
  const directory = path.join(projectDir, 'dist', 'computer-use', 'windows', arch);
  const executable = path.join(directory, 'setsuna-computer-win.exe');
  await mkdir(directory, { recursive: true });
  await copyFile(path.join(crate, 'target', target, 'release', 'setsuna-computer-win.exe'), executable);
  return executable;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildWindowsComputerHelper({ arch: process.argv[2] ?? process.arch });
}
