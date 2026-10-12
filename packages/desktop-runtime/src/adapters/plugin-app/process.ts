import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function appCompilerEntrypoint(): Readonly<{ path: string; execArgv: string[] }> {
  for (const name of ['./plugin-app-build-worker.js', './build-worker.js']) {
    const path = fileURLToPath(new URL(name, import.meta.url));
    if (existsSync(path)) return { path, execArgv: [] };
  }
  const path = fileURLToPath(new URL('./build-worker.ts', import.meta.url));
  return { path, execArgv: ['--import', pathToFileURL(createRequire(import.meta.url).resolve('tsx/esm')).href] };
}

export function appProcessEnvironment(toolchain: Readonly<Record<string, string>>): NodeJS.ProcessEnv {
  const keys = ['PATH', 'Path', 'HOME', 'USERPROFILE', 'SystemRoot', 'SYSTEMROOT', 'COMSPEC', 'APPDATA', 'LOCALAPPDATA',
    'TMPDIR', 'TEMP', 'TMP', 'LANG', 'TZ', 'COREPACK_HOME', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'NODE_EXTRA_CA_CERTS'];
  const allowed = (key: string) => keys.includes(key) || /^npm_config_/iu.test(key)
    || ['PNPM_HOME', 'COREPACK_NPM_REGISTRY', 'COREPACK_ENABLE_NETWORK', 'COREPACK_INTEGRITY_KEYS', 'NODE_USE_ENV_PROXY'].includes(key);
  return { ...Object.fromEntries(keys.filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]])),
    ...Object.fromEntries(Object.entries(toolchain).filter(([key]) => allowed(key))),
    ELECTRON_RUN_AS_NODE: '1', COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' };
}

export function runAppProcess(args: readonly string[], cwd: string, environment: NodeJS.ProcessEnv,
  signal: AbortSignal, ipc = false): Promise<unknown> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    let output = ''; let message: unknown; let failure: Error | undefined;
    const child = spawn(process.execPath, [...args], { cwd, env: environment, windowsHide: true,
      stdio: ipc ? ['ignore', 'pipe', 'pipe', 'ipc'] : ['ignore', 'pipe', 'pipe'] });
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const cancel = () => {
      failure = signal.reason instanceof Error ? signal.reason : new Error('Application build cancelled.');
      child.kill();
      killTimer = setTimeout(() => child.kill('SIGKILL'), 1000);
      killTimer.unref();
    };
    signal.addEventListener('abort', cancel, { once: true });
    child.stdout?.on('data', chunk => { output = (output + chunk.toString()).slice(-16_384); });
    child.stderr?.on('data', chunk => { output = (output + chunk.toString()).slice(-16_384); });
    child.on('message', value => { message = value; });
    child.once('error', error => { failure = error; });
    child.once('close', code => {
      signal.removeEventListener('abort', cancel);
      if (killTimer) clearTimeout(killTimer);
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error(`Application build command failed: ${output || JSON.stringify(message) || code}`));
      else resolve(message);
    });
    if (signal.aborted) cancel();
  });
}

export function awaitAppOperation<Result>(operation: Promise<Result>, signal: AbortSignal): Promise<Result> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const cancel = () => reject(signal.reason);
    signal.addEventListener('abort', cancel, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', cancel));
    if (signal.aborted) cancel();
  });
}
