import { useState } from 'react';

export function GitHubIdentity({ login, avatarUrl, showName = true }: { login: string; avatarUrl: string | null; showName?: boolean }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return <span className="pr-identity" title={login}>
    <span className="pr-identity__avatar" aria-hidden="true">
      {avatarUrl && avatarUrl !== failedUrl
        ? <img src={avatarUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedUrl(avatarUrl)} />
        : login.slice(0, 1).toUpperCase()}
    </span>
    <span className={showName ? 'pr-identity__name' : 'sd-visually-hidden'}>{login}</span>
  </span>;
}
