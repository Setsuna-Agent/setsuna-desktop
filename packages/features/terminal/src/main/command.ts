import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export type TerminalCommandLaunch = { args: string[] | string; env?: Record<string, string>; dispose(): Promise<void> };

/** Start the command as shell input, never as keystrokes racing an interactive prompt. */
export async function prepareTerminalCommand(
  shell: string,
  command: string,
  platform: NodeJS.Platform = process.platform,
): Promise<TerminalCommandLaunch> {
  if (platform !== 'win32') {
    const resumeShell = `exec ${shellLiteral(shell)} -i`;
    // eval keeps trailing comments and multiline constructs separate from the
    // final interactive shell. SIGINT must also return to a prompt: zsh -c
    // otherwise exits after Ctrl+C and the host closes the service's output tab.
    return {
      args: ['-i', '-c', `trap ${shellLiteral(resumeShell)} INT\neval ${shellLiteral(command)}\n${resumeShell}`],
      dispose: async () => undefined,
    };
  }

  // cmd /K accepts a batch file; replacing newlines with '&' would corrupt
  // blocks and make later commands become stdin for a long-running program.
  const directory = await mkdtemp(path.join(tmpdir(), 'setsuna-terminal-'));
  const dispose = () => rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  try {
    const file = path.join(directory, 'action.cmd');
    await writeFile(file, `@echo off\r\nchcp 65001 >nul\r\n${command.replace(/\r\n?|\n/gu, '\r\n')}\r\n`, 'utf8');
    // cmd does not understand node-pty's C argv quote escaping. Pass a raw
    // command line; /S removes the outer quotes while the path stays quoted.
    // Expanding a private variable once also preserves '%' in Windows paths.
    return { args: '/D /Q /S /K ""%SETSUNA_TERMINAL_ACTION_FILE%""',
      env: { SETSUNA_TERMINAL_ACTION_FILE: file }, dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}

function shellLiteral(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
