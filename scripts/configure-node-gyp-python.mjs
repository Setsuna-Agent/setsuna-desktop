import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const candidates = [
  process.env.PYTHON,
  'python',
  'python3',
  'python3.11',
  'python3.10',
].filter(Boolean);

const probeScript = [
  'import sys',
  'from distutils.version import StrictVersion',
  'print(sys.executable)',
].join('\n');

let pythonPath = '';
for (const candidate of candidates) {
  const result = spawnSync(String(candidate), ['-c', probeScript], { encoding: 'utf8' });
  if (result.status === 0) {
    pythonPath = result.stdout.trim().split(/\r?\n/u).at(-1) ?? '';
    if (pythonPath) break;
  }
}

if (!pythonPath) {
  process.stderr.write('Unable to locate a Python runtime with distutils.\n');
  process.exit(1);
}

console.log(`node-gyp python=${pythonPath}`);

if (process.env.GITHUB_ENV) {
  appendFileSync(process.env.GITHUB_ENV, `PYTHON=${pythonPath}\n`);
  appendFileSync(process.env.GITHUB_ENV, `npm_config_python=${pythonPath}\n`);
}
