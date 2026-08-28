import type { RuntimeEvent } from '@setsuna-desktop/contracts';
import {
  BrowserFeatureIcon as BrowserRendererFeatureIcon,
  BrowserFavicon,
  latestBrowserOpenRequest,
} from '@setsuna-desktop/feature-browser/renderer';

export function BrowserFeatureIcon({
  size,
}: Readonly<{ size?: number }>) {
  return <BrowserRendererFeatureIcon size={size} />;
}

export function BrowserFeatureFavicon({
  faviconUrl,
  loading,
}: Readonly<{ faviconUrl: string | null; loading: boolean }>) {
  return <BrowserFavicon faviconUrl={faviconUrl} loading={loading} />;
}

export function latestBrowserFeatureOpenRequest(events: RuntimeEvent[]) {
  return latestBrowserOpenRequest(events);
}
