import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${command} failed: ${result.error?.message ?? ''}\n${result.stderr}`);
  return result.stdout.trim();
}

/** Build a small native sidecar; no downloaded executable or extra runtime service. */
export async function buildMacComputerHelper({ arch = process.arch, projectDir = projectRoot } = {}) {
  if (process.platform !== 'darwin' || !['arm64', 'x64'].includes(arch)) throw new Error(`Unsupported macOS computer helper target: ${process.platform}-${arch}`);
  const source = path.join(projectDir, 'native', 'computer-use-macos');
  const files = (await readdir(source)).filter((file) => file.endsWith('.swift')).sort().map((file) => path.join(source, file));
  const directory = path.join(projectDir, 'dist', 'computer-use', 'macos', arch);
  const binary = path.join(directory, 'setsuna-computer');
  const target = `${arch === 'x64' ? 'x86_64' : 'arm64'}-apple-macos14.0`;
  const flags = ['-swift-version', '5', '-O', '-parse-as-library', '-target', target];
  const hash = createHash('sha256').update(run('xcrun', ['swiftc', '--version'])).update(JSON.stringify(flags));
  for (const file of files) hash.update(path.basename(file)).update(await readFile(file));
  const fingerprint = hash.digest('hex');
  if (await access(binary).then(() => true, () => false)
    && await readFile(path.join(directory, 'source.sha256'), 'utf8').catch(() => '') === fingerprint) return binary;
  await mkdir(directory, { recursive: true });
  run('xcrun', ['swiftc', ...flags, ...files, '-o', binary, '-framework', 'AppKit', '-framework', 'ScreenCaptureKit', '-framework', 'Carbon']);
  run('codesign', ['--force', '--sign', '-', binary]);
  await writeFile(path.join(directory, 'source.sha256'), fingerprint);
  console.info(`[computer-use] built macOS ${arch} window helper`);
  return binary;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildMacComputerHelper({ arch: process.argv[2] ?? process.arch });
}
