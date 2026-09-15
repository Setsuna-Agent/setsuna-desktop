import type { ExecFileOptions } from 'node:child_process';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GitHubApi } from '../../src/runtime/github-api.js';
import { GitHubCli } from '../../src/runtime/github-cli.js';

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile: execute }));
beforeEach(() => execute.mockReset());

function commandResult(stdout: string, code: number | string | null = 0, stderr = '') {
  const input = vi.fn();
  execute.mockImplementationOnce((_file: string, _args: string[], _options: ExecFileOptions,
    done: (error: { code: typeof code } | null, stdout: string, stderr: string) => void) => ({
    stdin: { on: vi.fn(), end: (body?: string) => { input(body); queueMicrotask(() => done(code === 0 ? null : { code }, stdout, stderr)); } },
  }));
  return input;
}
function http(status: number, body: unknown, headers = '') {
  return `HTTP/2.0 ${status} Status\r\nContent-Type: application/json\r\n${headers}\r\n${JSON.stringify(body)}`;
}

describe('GitHub CLI transport', () => {
  it('falls back to the app installation only when system gh is missing and provides a usable login command', async () => {
    const executable = "/Users/alice/My Apps/gh's/bin/gh";
    commandResult('', 'ENOENT');
    commandResult('{"hosts":{}}');
    const status = await new GitHubCli(executable).status();
    expect(status.state).toBe('signed-out');
    expect(status.loginCommand).toContain(' auth login --hostname github.com --web');
    expect(status.loginCommand).not.toBe('gh auth login --hostname github.com --web');
    expect(execute.mock.calls.map(([file]) => file)).toEqual(['gh', executable]);
    execute.mockClear();
    commandResult('{"hosts":{}}');
    expect((await new GitHubCli(executable).status()).state).toBe('signed-out');
    expect(execute.mock.calls.map(([file]) => file)).toEqual(['gh']);
  });

  it('uses the managed executable for Git credentials without exporting tokens or changing global Git configuration', async () => {
    const executable = '/app data/github-cli/bin/gh';
    commandResult('', 'ENOENT');
    commandResult('gh version 2.100.0');
    const environment = await new GitHubCli(executable).gitEnvironment();
    expect(environment.GIT_CONFIG_VALUE_2).toBe(`!'${executable}' auth git-credential`);
    expect(Object.keys(environment).some((key) => /TOKEN|AUTHORIZATION/u.test(key))).toBe(false);
    expect(execute.mock.calls.map(([, args]) => args)).toEqual([['--version'], ['--version']]);
  });

  it('uses the active CLI account and reads its identity through the same gh API authentication', async () => {
    commandResult(JSON.stringify({ hosts: { 'github.com': [{ active: false, state: 'error' }, { active: true, state: 'success' }] } }));
    commandResult(http(200, { login: 'alice', avatar_url: 'https://avatars.githubusercontent.com/u/1' }));
    expect(await new GitHubCli().status()).toEqual({ state: 'connected', login: 'alice', avatarUrl: 'https://avatars.githubusercontent.com/u/1', error: null, loginCommand: 'gh auth login --hostname github.com --web' });
    expect(execute.mock.calls.map(([file, args]) => [file, args])).toEqual([
      ['gh', ['auth', 'status', '--active', '--hostname', 'github.com', '--json', 'hosts']],
      ['gh', ['api', '/user', '--hostname', 'github.com', '--method', 'GET', '--include']],
    ]);
  });

  it.each([
    { output: '', code: 'ENOENT', state: 'not-installed' },
    { output: '{"hosts":{}}', code: 0, state: 'signed-out' },
    { output: '{"hosts":{"github.com":[{"active":true,"state":"error"}]}}', code: 0, state: 'error' },
    { output: '', code: 1, state: 'error' },
  ])('reports $state without treating missing CLI or a failed account check as a successful connection', async ({ output, code, state }) => {
    commandResult(output, code);
    expect(await new GitHubCli().status()).toMatchObject({ state, login: null, avatarUrl: null });
    expect(execute).toHaveBeenCalledOnce();
  });

  it('sends a GraphQL comment body unchanged on stdin and keeps pagination headers', async () => {
    const input = commandResult(http(200, { data: { comment: { id: 'C1' } } }));
    const api = new GitHubApi(new GitHubCli());
    const query = 'mutation($body: String!) { comment(body: $body) { id } }';
    const variables = { body: '中文\n"quoted" `code` $(text) @file\n<!-- marker -->' };
    expect(await api.graphql(query, variables)).toEqual({ comment: { id: 'C1' } });
    expect(JSON.parse(input.mock.calls[0][0])).toEqual({ query, variables });
    const [file, args, options] = execute.mock.calls[0];
    expect(file).toBe('gh');
    expect(args).toEqual(expect.arrayContaining(['api', '/graphql', '--method', 'POST', '--input', '-']));
    expect(args).not.toContain(variables.body);
    expect(options.shell).toBeUndefined();
    commandResult(http(200, [{ id: 'C1' }], 'Link: <https://api.github.com/items?page=2>; rel="next"\r\n'));
    expect(await api.request('/items')).toEqual({ value: [{ id: 'C1' }], more: true });
  });

  it('preserves rejected REST and GraphQL responses even when gh exits nonzero', async () => {
    const api = new GitHubApi(new GitHubCli());
    commandResult(http(403, { message: 'Organization access denied' }), 1, 'gh: Organization access denied (HTTP 403)');
    await expect(api.request('/items', { method: 'POST', body: {} })).rejects.toMatchObject({ code: 'GITHUB_ACCESS_DENIED', message: 'Organization access denied', requestRejected: true });
    commandResult(http(200, { data: { addComment: null }, errors: [{ message: 'Forbidden', type: 'FORBIDDEN', path: ['addComment'] }] }), 1, 'gh: Forbidden');
    await expect(api.graphql('mutation { addComment { id } }', {})).rejects.toMatchObject({ message: 'Forbidden', requestRejected: true });
    commandResult(http(429, { message: 'Slow down' }, 'Retry-After: 10\r\n'), 1);
    await expect(api.request('/items')).rejects.toMatchObject({ code: 'GITHUB_RATE_LIMITED', requestRejected: true });
  });

  it('does not claim rejection or retry a process failure without an HTTP response', async () => {
    commandResult('', null, 'connection reset');
    await expect(new GitHubApi(new GitHubCli()).graphql('mutation { addComment { id } }', {})).rejects.toMatchObject({ code: 'GITHUB_REQUEST_FAILED', message: 'connection reset' });
    expect(execute).toHaveBeenCalledOnce();
    const signal = AbortSignal.abort(new Error('Cancelled'));
    commandResult('', 'ABORT_ERR');
    await expect(new GitHubCli().request('/user', { signal })).rejects.toThrow('Cancelled');
  });

  it('rejects external endpoints and gh template expansion before starting a process', async () => {
    const cli = new GitHubCli();
    for (const path of ['https://other.example/user', '//other.example/user', '/repos/{owner}/{repo}', '/user\n--header']) {
      await expect(cli.request(path)).rejects.toThrow('Expected a GitHub API path.');
    }
    expect(execute).not.toHaveBeenCalled();
  });
});
