import { useState } from 'react';

/** Decorative avatar with an initial fallback; callers render the accessible login next to it. */
export function GitHubAvatar({ login, avatarUrl }: { login: string; avatarUrl: string | null }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return <span className="pr-identity__avatar" aria-hidden="true">
    {avatarUrl && avatarUrl !== failedUrl
      ? <img src={avatarUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedUrl(avatarUrl)} />
      : login.slice(0, 1).toUpperCase()}
  </span>;
}

export function GitHubIdentity({ login, avatarUrl, showName = true }: { login: string; avatarUrl: string | null; showName?: boolean }) {
  return <span className="pr-identity" title={login}>
    <GitHubAvatar login={login} avatarUrl={avatarUrl} />
    <span className={showName ? 'pr-identity__name' : 'sd-visually-hidden'}>{login}</span>
  </span>;
}
