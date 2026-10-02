import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') throw new Error('Native computer-use tests require macOS.');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'native', 'computer-use-macos');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'setsuna-computer-tests-'));
function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.status !== 0) throw result.error ?? new Error(`${command} failed (${result.status}).`);
}
try {
  const binary = path.join(temporary, 'input-tests');
  run('xcrun', ['swiftc', '-swift-version', '5', '-parse-as-library',
    ...['Protocol.swift', 'WindowKeyboard.swift', 'WindowGeometry.swift', 'test/InputTests.swift'].map((file) => path.join(source, file)),
    '-o', binary, '-framework', 'ApplicationServices']);
  run(binary, []);
} finally { await rm(temporary, { recursive: true, force: true }); }
