import { execFile } from 'node:child_process';
import { FeatureOperationFailure } from '@setsuna-desktop/feature-core/operation';
import type { PullRequestConnection } from '../contracts/index.js';

type CommandResult = { stdout: string; stderr: string; code: number | string | null };
const environment = {
  GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', GH_NO_EXTENSION_UPDATE_NOTIFIER: '1',
  GH_DEBUG: '', GH_FORCE_TTY: '', NO_COLOR: '1',
};

/** Use gh's account/credential handling without exporting its token or invoking a shell. */
function gh(executable: string, args: string[], input?: string, signal?: AbortSignal): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = execFile(executable, args, {
      env: { ...process.env, ...environment }, signal, windowsHide: true, timeout: 30_000, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8',
    }, (error, stdout, stderr) => {
      if (signal?.aborted) { reject(signal.reason); return; }
      resolve({ stdout, stderr, code: error ? error.code ?? null : 0 });
    });
    // JSON travels on stdin: no quoting, field expansion, or comment text in argv.
    child.stdin?.on('error', () => { /* Early process exit is reported by execFile. */ });
    child.stdin?.end(input);
  });
}

export class GitHubCli {
  constructor(private readonly managedExecutable?: string) {}

  private async run(args: string[], input?: string, signal?: AbortSignal) {
    let executable = 'gh';
    let result = await gh(executable, args, input, signal);
    if (result.code === 'ENOENT' && this.managedExecutable) {
      executable = this.managedExecutable;
      result = await gh(executable, args, input, signal);
    }
    return { ...result, executable };
  }

  async isInstalled(signal?: AbortSignal): Promise<boolean> {
    const result = await this.run(['--version'], undefined, signal);
    if (result.code === 'ENOENT') return false;
    if (result.code !== 0) throw new Error(result.stderr.trim() || 'Could not run GitHub CLI.');
    return true;
  }

  async status(signal?: AbortSignal): Promise<PullRequestConnection> {
    const auth = await this.run(['auth', 'status', '--active', '--hostname', 'github.com', '--json', 'hosts'], undefined, signal);
    const command = auth.executable === 'gh' ? 'gh' : process.platform === 'win32'
      ? `& '${auth.executable.replaceAll("'", "''")}'` : shellQuote(auth.executable);
    const blank = { login: null, avatarUrl: null, error: null, loginCommand: `${command} auth login --hostname github.com --web` };
    if (auth.code === 'ENOENT') return { ...blank, state: 'not-installed' };
    try {
      if (auth.code !== 0) throw new Error(auth.stderr.trim() || 'Could not check GitHub CLI authentication.');
      const status = JSON.parse(auth.stdout) as { hosts: Record<string, { active: boolean; state: string }[]> };
      const active = status.hosts['github.com']?.find((account) => account.active);
      if (!active) return { ...blank, state: 'signed-out' };
      // JSON auth status exits successfully even for invalid accounts or network failures.
      if (active.state !== 'success') throw new Error(auth.stderr.trim() || 'GitHub CLI could not validate the active account. Run gh auth status for details.');
      const response = await this.request('/user', { signal });
      if (response.status === 401) return { ...blank, state: 'signed-out' };
      const user = await response.json() as { login?: string; avatar_url?: string; message?: string };
      if (!response.ok || !user.login) return { ...blank, state: 'error', error: user.message ?? 'Could not read the GitHub CLI account.' };
      return { ...blank, state: 'connected', login: user.login, avatarUrl: user.avatar_url ?? null };
    } catch (error) {
      signal?.throwIfAborted();
      return { ...blank, state: 'error', error: error instanceof Error ? error.message : 'Could not connect to GitHub.' };
    }
  }

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    if (!path.startsWith('/') || path.startsWith('//') || /[\\\s{}]/u.test(path)) throw new Error('Expected a GitHub API path.');
    const args = ['api', path, '--hostname', 'github.com', '--method', init.method ?? 'GET', '--include'];
    new Headers(init.headers).forEach((value, key) => { args.push('--header', `${key}: ${value}`); });
    if (init.body !== undefined && typeof init.body !== 'string') throw new Error('Expected a JSON request body.');
    if (init.body !== undefined) args.push('--input', '-');
    const result = await this.run(args, init.body, init.signal ?? undefined);
    // gh exits nonzero for API/GraphQL errors, but still prints the HTTP response.
    // Preserve it so the API layer can distinguish rejected and ambiguous writes.
    const match = /^HTTP\/[\d.]+ (\d{3})[^\r\n]*\r?\n([\s\S]*?)\r?\n\r?\n/u.exec(result.stdout);
    if (!match) throw new FeatureOperationFailure({
      code: result.code === 'ENOENT' ? 'GITHUB_CLI_NOT_FOUND' : 'GITHUB_REQUEST_FAILED',
      message: result.stderr.trim() || 'GitHub CLI did not return an HTTP response.', retryable: false,
    });
    const status = Number(match[1]);
    const headers = new Headers();
    for (const line of match[2].split(/\r?\n/u)) {
      const colon = line.indexOf(':');
      if (colon > 0) headers.append(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
    }
    return new Response([204, 205, 304].includes(status) ? null : result.stdout.slice(match[0].length), { status, headers });
  }

  async gitEnvironment(): Promise<Record<string, string>> {
    const { executable, code, stderr } = await this.run(['--version']);
    if (code !== 0) throw new Error(stderr.trim() || 'Could not run GitHub CLI.');
    // Scope gh's credential helper to this fetch; never change the user's Git config.
    return {
      ...environment, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_CONFIG_COUNT: '4',
      GIT_CONFIG_KEY_0: 'credential.helper', GIT_CONFIG_VALUE_0: '',
      GIT_CONFIG_KEY_1: 'credential.https://github.com.helper', GIT_CONFIG_VALUE_1: '',
      GIT_CONFIG_KEY_2: 'credential.https://github.com.helper', GIT_CONFIG_VALUE_2: `!${shellQuote(executable.replaceAll('\\', '/'))} auth git-credential`,
      GIT_CONFIG_KEY_3: 'http.followRedirects', GIT_CONFIG_VALUE_3: 'false',
    };
  }
}

const shellQuote = (value: string) => `'${value.replaceAll("'", "'\"'\"'")}'`;
