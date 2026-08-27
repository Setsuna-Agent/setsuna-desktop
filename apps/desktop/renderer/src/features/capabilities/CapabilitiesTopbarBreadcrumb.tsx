import { ChevronRight } from 'lucide-react';
import { AppRouteTopbarPortal } from '../../shared/ui/AppRouteTopbarPortal.js';

export function CapabilitiesTopbarBreadcrumb({
  currentLabel,
  parentLabel,
  onBack,
}: {
  currentLabel: string;
  parentLabel: string;
  onBack: () => void;
}) {
  return (
    <AppRouteTopbarPortal>
      <nav className="desktop-capabilities-breadcrumb" aria-label={`${parentLabel} / ${currentLabel}`}>
        <button type="button" onClick={onBack}>{parentLabel}</button>
        <ChevronRight aria-hidden="true" />
        <span title={currentLabel}>{currentLabel}</span>
      </nav>
    </AppRouteTopbarPortal>
  );
}
