import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const preparedNodeShims = new Map<string, Promise<void>>();

/** Hooks use the app's Node runtime without changing the host or workspace toolchain. */
export async function prepareHookNodeEnvironment(
  dataPath: string,
  baseEnvironment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<NodeJS.ProcessEnv> {
  const binDirectory = path.resolve(dataPath, 'hook-tools', 'bin');
  const windows = platform === 'win32';
  const shimPath = path.join(binDirectory, windows ? 'node.cmd' : 'node');
  let preparation = preparedNodeShims.get(shimPath);
  if (!preparation) {
    preparation = (async () => {
      await mkdir(binDirectory, { recursive: true });
      // Keep the executable path in the child environment so spaces and shell
      // metacharacters in an app installation path cannot become shell syntax.
      const content = windows
        ? '@echo off\r\nsetlocal\r\nset "ELECTRON_RUN_AS_NODE=1"\r\n"%SETSUNA_HOOK_NODE_PATH%" %*\r\n'
        : '#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "$SETSUNA_HOOK_NODE_PATH" "$@"\n';
      await writeFile(shimPath, content, { encoding: 'utf8', mode: 0o700 });
    })().catch((error: unknown) => {
      preparedNodeShims.delete(shimPath);
      throw error;
    });
    preparedNodeShims.set(shimPath, preparation);
  }
  await preparation;

  const environment = { ...baseEnvironment };
  const pathKey = windows
    ? Object.keys(environment).find((key) => key.toLowerCase() === 'path') ?? 'PATH'
    : 'PATH';
  const inheritedPath = environment[pathKey] ?? '';
  if (windows) {
    // Node's Windows spawn only forwards one case-insensitive PATH key.
    for (const key of Object.keys(environment)) {
      if (key.toLowerCase() === 'path') delete environment[key];
    }
  }
  environment.PATH = [binDirectory, inheritedPath].filter(Boolean).join(windows ? ';' : path.delimiter);
  environment.SETSUNA_HOOK_NODE_PATH = process.execPath;
  return environment;
}
