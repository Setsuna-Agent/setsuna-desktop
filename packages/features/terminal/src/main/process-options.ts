import type { IPtyForkOptions, IWindowsPtyForkOptions } from 'node-pty';

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
