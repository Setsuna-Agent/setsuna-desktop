import { execFile } from 'node:child_process';
import { FeatureOperationFailure } from '@setsuna-desktop/feature-core/operation';

/** Fixed argument vectors only. Do not include stderr: Git may echo private transport configuration. */
export function git(cwd: string, args: string[], signal?: AbortSignal, environment?: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', ['-C', cwd, ...args], {
      signal, windowsHide: true, timeout: 120_000, maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_LITERAL_PATHSPECS: '1', ...environment },
      encoding: 'utf8',
    }, (error, stdout) => {
      if (error) {
        reject(signal?.aborted ? signal.reason : new FeatureOperationFailure({ code: 'PR_GIT_FAILED', message: 'Could not read the PR Git objects. Check Git installation, repository access and network, then retry.', retryable: false }));
      } else resolve(stdout);
    });
  });
}
