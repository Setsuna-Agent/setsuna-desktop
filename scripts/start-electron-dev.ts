import { execFileSync, spawn } from 'node:child_process';
import { resolve } from 'node:path';
import electronPath from 'electron';
import { buildElectron } from './build-electron.js';

const rootDir = resolve(import.meta.dirname, '..');

execFileSync('pnpm', ['build:contracts'], { cwd: rootDir, stdio: 'inherit' });
execFileSync('pnpm', ['build:runtime'], { cwd: rootDir, stdio: 'inherit' });
await buildElectron();

const child = spawn(String(electronPath), ['.'], {
  cwd: rootDir,
  stdio: 'inherit',
  env: {
    ...process.env,
    SETSUNA_DESKTOP_DEV_SERVER_URL: process.env.SETSUNA_DESKTOP_DEV_SERVER_URL ?? 'http://127.0.0.1:5174',
    SETSUNA_DESKTOP_RUNTIME_ENTRY: resolve(rootDir, 'packages/desktop-runtime/dist/cli.js'),
  },
});

child.on('exit', (code) => process.exit(code ?? 0));
