import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function runGit(args: string[], cwd: string): Promise<string> {
  return (await runGitRaw(args, cwd)).trim();
}

/** NUL-delimited filenames must retain leading/trailing whitespace. */
export async function runGitRaw(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-c', 'core.quotepath=false', ...args], {
    cwd,
    maxBuffer: 12 * 1024 * 1024,
    windowsHide: true,
  });
  return stdout;
}

export async function resolveGitCommit(gitRoot: string, ref: string): Promise<string> {
  if (!ref || ref.startsWith('-') || /[\0\r\n]/u.test(ref)) throw new Error('Invalid Git revision.');
  return runGit(['rev-parse', '--verify', '--end-of-options', ref + '^{commit}'], gitRoot);
}
