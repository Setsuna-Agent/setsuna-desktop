import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const [logFile, command, ...args] = process.argv.slice(2);

if (!logFile || !command) {
  console.error('Usage: node scripts/run-with-log.mjs <log-file> <command> [...args]');
  process.exit(1);
}

await mkdir(path.dirname(path.resolve(logFile)), { recursive: true });

const logStream = createWriteStream(logFile, { flags: 'a' });
const child = spawn(command, args, {
  env: process.env,
  shell: process.platform === 'win32',
  stdio: ['ignore', 'pipe', 'pipe'],
});

child.stdout.on('data', (chunk) => {
  process.stdout.write(chunk);
  logStream.write(chunk);
});

child.stderr.on('data', (chunk) => {
  process.stderr.write(chunk);
  logStream.write(chunk);
});

const exitCode = await new Promise((resolve) => {
  child.on('error', (error) => {
    console.error(error);
    logStream.write(`${error.stack ?? error.message}\n`);
    resolve(1);
  });
  child.on('close', (code) => resolve(code ?? 1));
});

await new Promise((resolve) => logStream.end(resolve));

process.exit(Number(exitCode));
