/** Shared by plugin import and login so only the registered GitHub endpoint uses host OAuth. */
export function isGitHubMcpEndpoint(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.origin === 'https://api.githubcopilot.com' && /^\/mcp(?:\/|$)/u.test(url.pathname)
      && !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
}
