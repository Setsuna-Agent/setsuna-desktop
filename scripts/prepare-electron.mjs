#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const DEFAULT_ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/';
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;
const HEARTBEAT_INTERVAL_MS = 15_000;
const TERMINATION_GRACE_MS = 5_000;
const require = createRequire(import.meta.url);

export async function prepareElectronBinary(options = {}) {
  const electronPackagePath = require.resolve('electron/package.json');
  const electronDirectory = path.dirname(electronPackagePath);
  const electronPackage = JSON.parse(readFileSync(electronPackagePath, 'utf8'));
  const version = String(electronPackage.version ?? '').trim();
  if (!version) throw new Error('Electron package version is unavailable.');

  if (installedElectronPath(electronDirectory, version)) return;

  const mirror = electronDownloadMirror(options.environment ?? process.env);
  const timeoutMs = options.timeoutMs ?? DOWNLOAD_TIMEOUT_MS;
  console.info(`[electron] Preparing Electron ${version} for ${process.platform}-${process.arch}.`);
  console.info(`[electron] Download source: ${downloadSourceLabel(mirror)}`);

  await runElectronInstaller({
    electronDirectory,
    environment: options.environment ?? process.env,
    mirror,
    timeoutMs,
    version,
  });

  if (!installedElectronPath(electronDirectory, version)) {
    throw new Error(`Electron ${version} installer exited without producing a usable binary.`);
  }
  console.info(`[electron] Electron ${version} is ready.`);
}

export function electronDownloadMirror(environment) {
  return firstNonEmptyString([
    environment.ELECTRON_MIRROR,
    environment.npm_config_electron_mirror,
    environment.NPM_CONFIG_ELECTRON_MIRROR,
  ]) ?? DEFAULT_ELECTRON_MIRROR;
}

function installedElectronPath(electronDirectory, version) {
  try {
    const installedVersion = readFileSync(path.join(electronDirectory, 'dist', 'version'), 'utf8')
      .trim()
      .replace(/^v/u, '');
    const executablePath = readFileSync(path.join(electronDirectory, 'path.txt'), 'utf8').trim();
    if (installedVersion !== version || !executablePath) return null;
    const resolved = path.join(electronDirectory, 'dist', executablePath);
    return existsSync(resolved) ? resolved : null;
  } catch {
    return null;
  }
}

function runElectronInstaller({ electronDirectory, environment, mirror, timeoutMs, version }) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(process.execPath, [path.join(electronDirectory, 'install.js')], {
      env: { ...environment, ELECTRON_MIRROR: mirror },
      stdio: 'inherit',
    });
    let timedOut = false;

    // Electron's installer is silent while downloading a roughly 100 MB archive.
    // Emit a heartbeat so a slow network cannot look like a frozen dev command.
    const heartbeat = setInterval(() => {
      const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
      console.info(`[electron] Download still in progress (${elapsedSeconds}s elapsed)...`);
    }, HEARTBEAT_INTERVAL_MS);
    heartbeat.unref();

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      const forceKill = setTimeout(() => child.kill('SIGKILL'), TERMINATION_GRACE_MS);
      forceKill.unref();
    }, timeoutMs);
    timeout.unref();

    const finish = () => {
      clearInterval(heartbeat);
      clearTimeout(timeout);
    };

    child.once('error', (error) => {
      finish();
      reject(error);
    });
    child.once('close', (code, signal) => {
      finish();
      if (timedOut) {
        reject(new Error(
          `Electron ${version} download exceeded ${Math.round(timeoutMs / 1000)} seconds. `
          + 'Set ELECTRON_MIRROR to another Electron mirror and retry.',
        ));
        return;
      }
      if (code !== 0) {
        reject(new Error(
          `Electron ${version} installer failed with ${signal ? `signal ${signal}` : `exit code ${String(code)}`}.`,
        ));
        return;
      }
      resolve();
    });
  });
}

function downloadSourceLabel(mirror) {
  try {
    return new URL(mirror).origin;
  } catch {
    return 'custom source';
  }
}

function firstNonEmptyString(values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  prepareElectronBinary().catch((error) => {
    console.error(`[electron] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
