import { CircleUserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useReviewRendererHost } from '../host.js';

export function GitAuthorAvatar({ author, githubUrl, compact = false }: {
  author: string;
  githubUrl?: string | null;
  compact?: boolean;
}) {
  const { bridge } = useReviewRendererHost();
  const [avatar, setAvatar] = useState<{ key: string; url: string | null } | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!githubUrl || !bridge?.getCommitAuthorAvatar) return;
    let disposed = false;
    void bridge.getCommitAuthorAvatar(githubUrl).then((url) => {
      if (!disposed) setAvatar({ key: githubUrl, url });
    }).catch(() => {
      if (!disposed) setAvatar({ key: githubUrl, url: null });
    });
    return () => { disposed = true; };
  }, [bridge, githubUrl]);
  const url = avatar?.key === githubUrl ? avatar?.url : null;
  return <span className={'git-author-avatar' + (compact ? ' git-author-avatar--compact' : '')} aria-hidden="true">
    {compact ? <CircleUserRound size={12} /> : author.slice(0, 1).toLocaleUpperCase()}
    {url && url !== failedUrl ? <img key={url} src={url} alt="" referrerPolicy="no-referrer" onError={() => setFailedUrl(url)} /> : null}
  </span>;
}
