#!/usr/bin/env node
import { RUNTIME_PROCESS_SHUTDOWN_MESSAGE } from '@setsuna-desktop/contracts';
import { createRuntimeServer } from './server/runtime-server.js';
import type { RuntimeServer } from './server/types.js';

const DEFAULT_PORT = 0;

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

const port = Number(argValue('--port') ?? DEFAULT_PORT);
const dataDir = process.env.SETSUNA_DESKTOP_DATA_DIR;
const token = process.env.SETSUNA_DESKTOP_RUNTIME_TOKEN;
const builtinSkillsDir = process.env.SETSUNA_DESKTOP_BUILTIN_SKILLS_DIR;
const builtinPluginsDir = process.env.SETSUNA_DESKTOP_BUILTIN_PLUGINS_DIR;

if (!dataDir) {
  console.error('SETSUNA_DESKTOP_DATA_DIR is required');
  process.exit(1);
}

if (!token) {
  console.error('SETSUNA_DESKTOP_RUNTIME_TOKEN is required');
  process.exit(1);
}

const runtimeDataDir = dataDir;
const runtimeToken = token;
let activeServer: RuntimeServer | null = null;
let shutdownRequested = false;
let shutdownPromise: Promise<void> | null = null;
let stdinBuffer = '';

function requestShutdown(): void {
  shutdownRequested = true;
  if (!activeServer || shutdownPromise) return;
  shutdownPromise = activeServer.close();
  void shutdownPromise.then(
    () => process.exit(0),
    (error) => {
      console.error(error);
      process.exit(1);
    },
  );
}

function handleControlInput(chunk: string): void {
  stdinBuffer += chunk;
  for (;;) {
    const newline = stdinBuffer.indexOf('\n');
    if (newline === -1) return;
    const line = stdinBuffer.slice(0, newline).trim();
    stdinBuffer = stdinBuffer.slice(newline + 1);
    if (!line) continue;
    if (line === RUNTIME_PROCESS_SHUTDOWN_MESSAGE.trim()) requestShutdown();
  }
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', handleControlInput);
process.stdin.on('end', requestShutdown);
process.on('SIGINT', requestShutdown);
process.on('SIGTERM', requestShutdown);

async function main(): Promise<void> {
  const server = await createRuntimeServer({
    dataDir: runtimeDataDir,
    token: runtimeToken,
    version: process.env.npm_package_version ?? '0.1.0',
    builtinSkillsDir,
    builtinPluginsDir,
  });
  activeServer = server;
  if (shutdownRequested) {
    requestShutdown();
    return;
  }

  await server.listen(port);
  if (shutdownRequested) {
    requestShutdown();
    return;
  }
  const address = server.address();
  const resolvedPort = typeof address === 'object' && address ? address.port : port;
  console.log(JSON.stringify({ type: 'ready', port: resolvedPort }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
