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
import { resolveElectronDevApp, type ElectronDevApp } from './prepare-electron-dev-app.js';

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
runPnpm(['build:feature-core']);
runPnpm(['build:features']);
runPnpm(['build:runtime']);
if (process.platform === 'win32' && process.arch === 'x64') {
  // Dev resolves the sidecar from .cache before Electron starts, just like a packaged build.
  runPnpm(['build:windows-sandbox']);
  runPnpm(['prepare:windows-sandbox-curl']);
}
await buildElectron();

let devApp: ElectronDevApp = { executable: String(electronPath) };
try {
  devApp = resolveElectronDevApp(rootDir, devApp.executable);
} catch (error) {
  // Development notifications are optional; preparation failures must not prevent development.
  console.warn('[electron-dev] notification app cache unavailable; continuing with the original Electron:', error);
}

let activeElectron: ChildProcess | null = null;
let terminationSignal: NodeJS.Signals | null = null;
const preparationAbort = new AbortController();
let preparation = Promise.resolve();

function startElectron(): void {
  const child = spawn(devApp.executable, ['.'], {
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
      finish(signalExitCode(terminationSignal));
      return;
    }
    if (isDesktopDevRelaunchExit(code, signal)) {
      console.info('[electron-dev] planned relaunch requested; restarting Electron');
      startElectron();
      return;
    }
    finish(code ?? signalExitCode(signal));
  });
}

function forwardTerminationSignal(signal: NodeJS.Signals): void {
  if (terminationSignal) return;
  terminationSignal = signal;
  preparationAbort.abort();
  if (!activeElectron || activeElectron.exitCode !== null || activeElectron.signalCode !== null) {
    finish(signalExitCode(signal));
    return;
  }
  activeElectron.kill(signal);
}

function finish(code: number): void {
  preparationAbort.abort();
  // Stop external preparation commands and clean staging before the supervisor exits.
  void preparation.then(() => process.exit(code));
}

function signalExitCode(signal: NodeJS.Signals | null): number {
  if (signal === 'SIGINT') return 130;
  if (signal === 'SIGTERM') return 143;
  return 1;
}

process.once('SIGINT', () => forwardTerminationSignal('SIGINT'));
process.once('SIGTERM', () => forwardTerminationSignal('SIGTERM'));
startElectron();
// Optional notification setup never delays spawning Electron or a planned relaunch.
preparation = devApp.prepare?.(preparationAbort.signal).then((executable) => {
  if (preparationAbort.signal.aborted) return;
  devApp.executable = executable;
  console.info('[electron-dev] notification app ready; it will be used on the next Electron launch');
}).catch((error: unknown) => {
  if (!preparationAbort.signal.aborted) {
    console.warn('[electron-dev] notification app preparation failed; Electron continues running:', error);
  }
}) ?? Promise.resolve();
