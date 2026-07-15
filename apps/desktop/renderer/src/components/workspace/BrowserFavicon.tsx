import { useEffect, useState } from 'react';
import { Globe2, LoaderCircle } from 'lucide-react';

export function BrowserFavicon({ faviconUrl, loading }: { faviconUrl: string | null; loading: boolean }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showFavicon = Boolean(faviconUrl && failedUrl !== faviconUrl);

  useEffect(() => {
    if (loading) setFailedUrl(null);
  }, [loading]);

  return (
    <span className="desktop-browser-tab__favicon" aria-hidden="true">
      {loading ? (
        <LoaderCircle className="is-spinning" size={13} />
      ) : showFavicon && faviconUrl ? (
        <img
          alt=""
          draggable={false}
          referrerPolicy="no-referrer"
          src={faviconUrl}
          onError={() => setFailedUrl(faviconUrl)}
        />
      ) : (
        <Globe2 size={13} />
      )}
    </span>
  );
}
