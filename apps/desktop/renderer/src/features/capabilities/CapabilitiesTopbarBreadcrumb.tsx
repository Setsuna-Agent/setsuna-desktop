import { ChevronRight } from 'lucide-react';
import { getDesktopPlatform } from '../../shared/lib/desktopPlatform.js';
import { AppRouteTopbarPortal } from '../../shared/ui/AppRouteTopbarPortal.js';
import { shouldRenderCapabilitiesNavigationInPage } from './capabilitiesLayout.js';

export function CapabilitiesTopbarBreadcrumb({
  currentLabel,
  parentLabel,
  onBack,
}: {
  currentLabel: string;
  parentLabel: string;
  onBack: () => void;
}) {
  const breadcrumb = (
    <nav className="desktop-capabilities-breadcrumb" aria-label={`${parentLabel} / ${currentLabel}`}>
      <button type="button" onClick={onBack}>{parentLabel}</button>
      <ChevronRight aria-hidden="true" />
      <span title={currentLabel}>{currentLabel}</span>
    </nav>
  );

  return shouldRenderCapabilitiesNavigationInPage(getDesktopPlatform())
    ? breadcrumb
    : <AppRouteTopbarPortal>{breadcrumb}</AppRouteTopbarPortal>;
}
