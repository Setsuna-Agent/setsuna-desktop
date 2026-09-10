import { githubCommitUrl } from './git-commit-url.js';

/** Share hover/detail requests without making local Git reads wait for the network. */
export function createGitHubCommitAvatarLoader(fetch: (url: string, init: RequestInit) => Promise<Response>) {
  const cache = new Map<string, { expiresAt: number; result: Promise<string | null> }>();
  return (commitUrl: string): Promise<string | null> => {
    const apiUrl = commitApiUrl(commitUrl);
    if (!apiUrl) return Promise.resolve(null);
    const cached = cache.get(apiUrl);
    if (cached && cached.expiresAt > Date.now()) return cached.result;
    cache.delete(apiUrl);
    if (cache.size >= 256) cache.delete(cache.keys().next().value!);
    const result = loadAvatar(apiUrl, fetch);
    cache.set(apiUrl, { expiresAt: Date.now() + 5 * 60_000, result });
    return result;
  };
}

function commitApiUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const [, owner, repository, kind, oid, extra] = url.pathname.split('/');
    // Accept only the credential-free commit links already produced by the Git adapter.
    if (extra !== undefined || kind !== 'commit' || githubCommitUrl(`https://github.com/${owner}/${repository}`, oid ?? '') !== value) return null;
    return `https://api.github.com/repos/${owner}/${repository}/commits/${oid}`;
  } catch {
    return null;
  }
}

async function loadAvatar(apiUrl: string, fetch: (url: string, init: RequestInit) => Promise<Response>): Promise<string | null> {
  try {
    const response = await fetch(apiUrl, {
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) return null;
    const data = await response.json() as { author?: { avatar_url?: unknown } | null } | null;
    if (typeof data?.author?.avatar_url !== 'string') return null;
    const avatar = new URL(data.author.avatar_url);
    if (avatar.protocol !== 'https:' || avatar.hostname !== 'avatars.githubusercontent.com' || avatar.username || avatar.password || avatar.port) return null;
    avatar.searchParams.set('s', '64');
    return avatar.href;
  } catch {
    // Offline, private/unpublished commits, rate limits and unlinked authors keep the fallback.
    return null;
  }
}
