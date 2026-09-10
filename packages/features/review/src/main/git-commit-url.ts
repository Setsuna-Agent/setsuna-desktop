/** Convert only recognized GitHub remotes; local paths and other hosts have no GitHub action. */
export function githubCommitUrl(remote: string, oid: string): string | null {
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/iu.test(oid)) return null;
  const normalized = remote.replace(/^git@github\.com:/iu, 'https://github.com/');
  try {
    const url = new URL(normalized);
    if (url.hostname.toLowerCase() !== 'github.com' || !['https:', 'http:', 'ssh:', 'git:'].includes(url.protocol)) return null;
    const parts = url.pathname.replace(/\/$/u, '').replace(/\.git$/u, '').split('/').filter(Boolean);
    if (parts.length !== 2 || parts.some((part) => !/^[\w.-]+$/u.test(part) || part === '.' || part === '..')) return null;
    return `https://github.com/${parts[0]}/${parts[1]}/commit/${oid}`;
  } catch {
    return null;
  }
}
