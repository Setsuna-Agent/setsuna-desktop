import { afterEach, expect, it, vi } from 'vitest';
import { createGitHubCommitAvatarLoader } from '../../src/main/github-commit-avatar.js';

const commitUrl = `https://github.com/owner/repo/commit/${'a'.repeat(40)}`;
const avatarUrl = 'https://avatars.githubusercontent.com/u/123?v=4';
afterEach(() => vi.useRealTimers());

it('uses the linked GitHub author and shares pending/results between hover and detail views', async () => {
  let finish!: (response: Response) => void;
  const fetch = vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; }));
  const load = createGitHubCommitAvatarLoader(fetch);
  const first = load(commitUrl);
  const second = load(commitUrl);
  expect(fetch).toHaveBeenCalledExactlyOnceWith(commitUrl.replace('github.com/', 'api.github.com/repos/').replace('/commit/', '/commits/'), expect.objectContaining({
    credentials: 'omit', redirect: 'error', signal: expect.any(AbortSignal),
  }));
  finish(Response.json({ author: { avatar_url: avatarUrl }, committer: { avatar_url: 'https://avatars.githubusercontent.com/u/999' } }));
  expect(await first).toBe(avatarUrl + '&s=64');
  expect(await second).toBe(await load(commitUrl));
  expect(fetch).toHaveBeenCalledOnce();
});

it('never fetches arbitrary hosts, credentials or malformed commit links', async () => {
  const fetch = vi.fn();
  const load = createGitHubCommitAvatarLoader(fetch);
  for (const value of ['', 'file:///repo', commitUrl.replace('github.com', 'github.com.evil.test'), commitUrl.replace('github.com', 'user:secret@github.com'), commitUrl + '/extra', commitUrl + '?token=secret', commitUrl.replace('/owner/', '/../')]) {
    expect(await load(value)).toBeNull();
  }
  expect(fetch).not.toHaveBeenCalled();
});

it('falls back for unlinked authors, failed requests and untrusted avatar URLs', async () => {
  const outcomes = [
    Response.json({ author: null, committer: { avatar_url: avatarUrl } }),
    Response.json({ author: { avatar_url: 'https://evil.test/avatar' } }),
    Response.json({ author: { avatar_url: 'http://avatars.githubusercontent.com/u/1' } }),
    Response.json({ author: { avatar_url: 'https://secret@avatars.githubusercontent.com/u/1' } }),
    new Response('', { status: 404 }), new Response('', { status: 403 }), new Response('invalid json'),
  ];
  for (const response of outcomes) {
    expect(await createGitHubCommitAvatarLoader(async () => response)(commitUrl)).toBeNull();
  }
  expect(await createGitHubCommitAvatarLoader(async () => { throw new Error('offline'); })(commitUrl)).toBeNull();
});

it('retries after the cache expires so a temporary failure does not hide avatars forever', async () => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(Response.json({ author: { avatar_url: avatarUrl } }));
  const load = createGitHubCommitAvatarLoader(fetch);
  expect(await load(commitUrl)).toBeNull();
  expect(await load(commitUrl)).toBeNull();
  expect(fetch).toHaveBeenCalledOnce();
  vi.advanceTimersByTime(5 * 60_000);
  expect(await load(commitUrl)).toBe(avatarUrl + '&s=64');
  expect(fetch).toHaveBeenCalledTimes(2);
});
