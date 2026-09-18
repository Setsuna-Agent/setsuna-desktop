import type { IPtyForkOptions, IWindowsPtyForkOptions } from 'node-pty';
import { release } from 'node:os';
import type { DesktopTerminalSession } from '../contracts/index.js';

export type TerminalProcessOptionsInput = Readonly<{
  cols: number;
  cwd: string;
  env: NodeJS.ProcessEnv;
  rows: number;
}>;

/**
 * node-pty warns and ignores an explicit encoding on Windows, so terminal
 * output uses its native string mode. Keep the system ConPTY implementation;
 * the dependency patch handles its close-time console-list race without the
 * multi-second shutdown delay of the bundled implementation.
 */
export function terminalProcessOptions(
  input: TerminalProcessOptionsInput,
  platform: NodeJS.Platform = process.platform,
): IPtyForkOptions | IWindowsPtyForkOptions {
  const common = {
    cols: input.cols,
    cwd: input.cwd,
    env: input.env,
    name: 'xterm-256color',
    rows: input.rows,
  };
  return platform === 'win32' ? { ...common, useConpty: true } : common;
}

export function terminalWindowsPty(
  platform: NodeJS.Platform = process.platform,
  osRelease: string = release(),
): DesktopTerminalSession['windowsPty'] {
  if (platform !== 'win32') return undefined;
  const buildNumber = Number.parseInt(osRelease.split('.')[2] ?? '0', 10);
  // Match node-pty's backend selection and let xterm apply the OS-specific
  // resize/reflow rules instead of treating ConPTY output as a Unix stream.
  return { backend: buildNumber >= 18309 ? 'conpty' : 'winpty', buildNumber };
}
