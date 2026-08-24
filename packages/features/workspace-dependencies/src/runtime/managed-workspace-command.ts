import { spawn } from 'node:child_process';

const MAX_COMMAND_OUTPUT_CHARS = 24_000;

export type ManagedWorkspaceCommandResult = {
  exitCode: number | null;
  stderr: string;
  stdout: string;
};

export function runManagedWorkspaceCommand(
  command: string,
  args: string[],
  environment?: NodeJS.ProcessEnv,
): Promise<ManagedWorkspaceCommandResult> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(command, args, {
      env: environment ?? process.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    child.stdout.on('data', (chunk: Buffer) => {
      stdout = appendCommandOutput(stdout, chunk.toString());
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = appendCommandOutput(stderr, chunk.toString());
    });
    child.once('error', reject);
    child.once('close', (exitCode) => resolve({ exitCode, stderr, stdout }));
  });
}

function appendCommandOutput(current: string, delta: string): string {
  const next = current + delta;
  return next.length <= MAX_COMMAND_OUTPUT_CHARS ? next : next.slice(-MAX_COMMAND_OUTPUT_CHARS);
}
