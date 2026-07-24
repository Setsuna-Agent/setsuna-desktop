import electronPath from 'electron';
import {
  execFileSync,
  spawn,
  type ChildProcess,
} from 'node:child_process';
import { resolve } from 'node:path';
import {
  DESKTOP_DEV_RELAUNCH_EXIT_CODE,
  DESKTOP_DEV_RELAUNCH_EXIT_CODE_ENV,
  isDesktopDevRelaunchExit,
} from '../apps/desktop/main/src/dev-relaunch-protocol.js';
import { buildElectron } from './build-electron.js';

const rootDir = resolve(import.meta.dirname, '..');

function runPnpm(args: string[]): void {
  const npmExecPath = process.env.npm_execpath;

  // 如果可用，则复用父级 pnpm 脚本中的包管理器入口。
  if (npmExecPath) {
    execFileSync(process.execPath, [npmExecPath, ...args], { cwd: rootDir, stdio: 'inherit' });
    return;
  }

  execFileSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', args, { cwd: rootDir, stdio: 'inherit' });
}

runPnpm(['build:contracts']);
runPnpm(['build:runtime']);
await buildElectron();

let activeElectron: ChildProcess | null = null;
let terminationSignal: NodeJS.Signals | null = null;

function startElectron(): void {
  const child = spawn(String(electronPath), ['.'], {
    cwd: rootDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      [DESKTOP_DEV_RELAUNCH_EXIT_CODE_ENV]: String(DESKTOP_DEV_RELAUNCH_EXIT_CODE),
      SETSUNA_DESKTOP_DEV_SERVER_URL:
        process.env.SETSUNA_DESKTOP_DEV_SERVER_URL ?? 'http://127.0.0.1:5174',
      SETSUNA_DESKTOP_RUNTIME_ENTRY:
        resolve(rootDir, 'packages/desktop-runtime/dist/cli.js'),
    },
  });
  activeElectron = child;
  child.once('close', (code, signal) => {
    if (activeElectron === child) activeElectron = null;
    if (terminationSignal) {
      process.exit(signalExitCode(terminationSignal));
    }
    if (isDesktopDevRelaunchExit(code, signal)) {
      console.info('[electron-dev] planned relaunch requested; restarting Electron');
      startElectron();
      return;
    }
    process.exit(code ?? signalExitCode(signal));
  });
}

function forwardTerminationSignal(signal: NodeJS.Signals): void {
  if (terminationSignal) return;
  terminationSignal = signal;
  if (!activeElectron || activeElectron.exitCode !== null || activeElectron.signalCode !== null) {
    process.exit(signalExitCode(signal));
  }
  activeElectron.kill(signal);
}

function signalExitCode(signal: NodeJS.Signals | null): number {
  if (signal === 'SIGINT') return 130;
  if (signal === 'SIGTERM') return 143;
  return 1;
}

process.once('SIGINT', () => forwardTerminationSignal('SIGINT'));
process.once('SIGTERM', () => forwardTerminationSignal('SIGTERM'));
startElectron();
