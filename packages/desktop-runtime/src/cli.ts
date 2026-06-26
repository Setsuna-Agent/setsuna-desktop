#!/usr/bin/env node
import { createRuntimeServer } from './server/runtime-server.js';

const DEFAULT_PORT = 0;

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

const port = Number(argValue('--port') ?? DEFAULT_PORT);
const dataDir = process.env.SETSUNA_DESKTOP_DATA_DIR;
const token = process.env.SETSUNA_DESKTOP_RUNTIME_TOKEN;

if (!dataDir) {
  console.error('SETSUNA_DESKTOP_DATA_DIR is required');
  process.exit(1);
}

if (!token) {
  console.error('SETSUNA_DESKTOP_RUNTIME_TOKEN is required');
  process.exit(1);
}

const server = await createRuntimeServer({
  dataDir,
  token,
  version: process.env.npm_package_version ?? '0.1.0',
});

await server.listen(port);
const address = server.address();
const resolvedPort = typeof address === 'object' && address ? address.port : port;
console.log(JSON.stringify({ type: 'ready', port: resolvedPort }));

function shutdown(): void {
  server.close().finally(() => process.exit(0)).catch(() => process.exit(1));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

