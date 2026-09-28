import { Globe2 } from 'lucide-react';
import { useState } from 'react';

export function MarkdownWebLinkIcon({ href }: { href: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const faviconUrl = resolveFaviconUrl(href);

  return (
    <span className="chat-markdown__web-link-icon" aria-hidden="true">
      {faviconUrl && failedUrl !== faviconUrl ? (
        <img
          alt=""
          decoding="async"
          draggable={false}
          loading="lazy"
          referrerPolicy="no-referrer"
          src={faviconUrl}
          onError={() => setFailedUrl(faviconUrl)}
        />
      ) : <Globe2 size={12} />}
    </span>
  );
}

function resolveFaviconUrl(href: string): string | null {
  try {
    const url = new URL(href);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    // Use only the site's origin, without forwarding link credentials, paths or queries.
    return new URL('/favicon.ico', url.origin).href;
  } catch {
    return null;
  }
}
