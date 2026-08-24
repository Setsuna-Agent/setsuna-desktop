import type { RuntimeEvent } from '@setsuna-desktop/contracts';
import {
  BrowserFavicon,
  latestBrowserOpenRequest,
} from '@setsuna-desktop/feature-browser/renderer';

export function BrowserFeatureFavicon({
  faviconUrl,
  loading,
}: Readonly<{ faviconUrl: string | null; loading: boolean }>) {
  return <BrowserFavicon faviconUrl={faviconUrl} loading={loading} />;
}

export function latestBrowserFeatureOpenRequest(events: RuntimeEvent[]) {
  return latestBrowserOpenRequest(events);
}
