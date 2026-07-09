import { spawn, spawnSync } from 'node:child_process';
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
const startedAt = Date.now();
let lastOutputAt = startedAt;
let timedOut = false;

function writeProgress(message) {
  const line = `[run-with-log] ${message}\n`;
  process.stdout.write(line);
  logStream.write(line);
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m${String(seconds).padStart(2, '0')}s` : `${seconds}s`;
}

function envNumber(name) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function formatCommand() {
  return [command, ...args].join(' ');
}

function terminateChildTree() {
  if (process.platform === 'win32' && child.pid) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    return;
  }

  child.kill('SIGTERM');
  setTimeout(() => child.kill('SIGKILL'), 10_000).unref?.();
}

const heartbeatSeconds = envNumber('RUN_WITH_LOG_HEARTBEAT_SECONDS');
const timeoutMinutes = envNumber('RUN_WITH_LOG_TIMEOUT_MINUTES');

writeProgress(`starting; command=${formatCommand()} cwd=${process.cwd()} platform=${process.platform} node=${process.version}`);

const child = spawn(command, args, {
  env: process.env,
  shell: process.platform === 'win32',
  stdio: ['ignore', 'pipe', 'pipe'],
});

const heartbeatTimer = heartbeatSeconds
  ? setInterval(() => {
    const now = Date.now();
    const quietMs = now - lastOutputAt;
    const heartbeatMs = heartbeatSeconds * 1000;
    if (quietMs >= heartbeatMs) {
      writeProgress(
        `still running; elapsed=${formatDuration(now - startedAt)} quiet=${formatDuration(quietMs)} command=${formatCommand()}`,
      );
      lastOutputAt = now;
    }
  }, heartbeatSeconds * 1000)
  : null;

heartbeatTimer?.unref?.();

const timeoutTimer = timeoutMinutes
  ? setTimeout(() => {
    timedOut = true;
    writeProgress(`timeout after ${formatDuration(timeoutMinutes * 60 * 1000)}; terminating command=${formatCommand()}`);
    terminateChildTree();
  }, timeoutMinutes * 60 * 1000)
  : null;

timeoutTimer?.unref?.();

child.stdout.on('data', (chunk) => {
  lastOutputAt = Date.now();
  process.stdout.write(chunk);
  logStream.write(chunk);
});

child.stderr.on('data', (chunk) => {
  lastOutputAt = Date.now();
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

if (heartbeatTimer) clearInterval(heartbeatTimer);
if (timeoutTimer) clearTimeout(timeoutTimer);
writeProgress(`finished; exitCode=${Number(exitCode)} timedOut=${timedOut} elapsed=${formatDuration(Date.now() - startedAt)} command=${formatCommand()}`);
await new Promise((resolve) => logStream.end(resolve));

process.exit(timedOut ? 124 : Number(exitCode));
