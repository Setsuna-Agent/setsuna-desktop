import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync, readFileSync, realpathSync, statSync,
} from 'node:fs';
import { copyFile, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const appName = 'Setsuna Desktop Dev';
const bundleId = 'dev.setsuna.desktop.development';
const launchServices = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';

type DevAppCache = {
  sourceBundle: string; icon: string; cacheDir: string;
  bundle: string; executable: string; marker: string; fingerprint: string;
};
export type ElectronDevApp = {
  executable: string;
  prepare?: (signal: AbortSignal) => Promise<string>;
};

/** Only inspect small cache metadata here; copying, signing and registration run after launch. */
export function resolveElectronDevApp(
  rootDir: string,
  electronPath: string,
  platform: NodeJS.Platform = process.platform,
): ElectronDevApp {
  if (platform !== 'darwin') return { executable: electronPath };

  const sourceExecutable = realpathSync(electronPath);
  const sourceBundle = dirname(dirname(dirname(sourceExecutable)));
  const icon = join(rootDir, 'assets/build/icon.icns');
  const cacheDir = join(rootDir, '.cache/electron-dev');
  const bundle = join(cacheDir, `${appName}.app`);
  const executable = join(bundle, 'Contents/MacOS/Electron');
  const marker = join(cacheDir, 'prepared.json');
  const fingerprint = createHash('sha256').update(JSON.stringify({
    schema: 1,
    sourceExecutable,
    sourceStat: fileStamp(sourceExecutable),
    sourceInfo: readFileSync(join(sourceBundle, 'Contents/Info.plist'), 'utf8'),
    iconStat: fileStamp(icon),
  })).digest('hex');

  // Code changes live outside the bundle. Warm launches need no copy, signing or OS registration.
  if (existsSync(executable) && cacheMatches(marker, fingerprint)) {
    return { executable };
  }

  const cache = { sourceBundle, icon, cacheDir, bundle, executable, marker, fingerprint };
  // A stale bundle must not be used while the background task replaces it.
  return { executable: electronPath, prepare: (signal) => prepareCachedApp(cache, signal) };
}

async function prepareCachedApp(cache: DevAppCache, signal: AbortSignal): Promise<string> {
  const { sourceBundle, icon, cacheDir, bundle, executable, marker, fingerprint } = cache;
  signal.throwIfAborted();
  console.info('[electron-dev] preparing signed macOS development app');
  await mkdir(cacheDir, { recursive: true });
  signal.throwIfAborted();
  const stagingDir = await mkdtemp(join(cacheDir, '.prepare-'));
  const stagedBundle = join(stagingDir, `${appName}.app`);
  try {
    // ditto preserves Electron's framework symlinks. Never sign the shared node_modules bundle.
    await run('/usr/bin/ditto', [sourceBundle, stagedBundle], signal);
    const plist = join(stagedBundle, 'Contents/Info.plist');
    for (const [key, value] of Object.entries({
      CFBundleIdentifier: bundleId,
      CFBundleName: appName,
      CFBundleDisplayName: appName,
    })) {
      await run('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, plist], signal);
    }
    await copyFile(icon, join(stagedBundle, 'Contents/Resources/electron.icns'));
    await run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', stagedBundle], signal);
    await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', stagedBundle], signal);

    // Only replace a previous usable bundle after preparation and signature verification succeed.
    signal.throwIfAborted();
    await rm(bundle, { recursive: true, force: true });
    signal.throwIfAborted();
    await rename(stagedBundle, bundle);
    // Register at the permanent path: macOS rejects notification clients inside its temporary directory.
    await run(launchServices, ['-f', bundle], signal);
    signal.throwIfAborted();
    await writeFile(marker, JSON.stringify({ fingerprint }));
    return executable;
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
  }
}

function cacheMatches(marker: string, fingerprint: string): boolean {
  if (!existsSync(marker)) return false;
  try {
    const cached = JSON.parse(readFileSync(marker, 'utf8'));
    return cached.fingerprint === fingerprint;
  } catch { return false; }
}

function fileStamp(file: string): { size: number; mtimeMs: number } {
  const { size, mtimeMs } = statSync(file);
  return { size, mtimeMs };
}

function run(command: string, args: string[], signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    let failure: Error | null = null;
    const child = execFile(command, args, { signal, timeout: 30_000, killSignal: 'SIGKILL' }, (error) => {
      failure = error;
    });
    // Abort reports an error before exit; wait for the process to close before deleting its staging files.
    child.once('close', () => {
      if (signal.aborted) reject(signal.reason);
      else if (failure) reject(failure);
      else resolve();
    });
  });
}
