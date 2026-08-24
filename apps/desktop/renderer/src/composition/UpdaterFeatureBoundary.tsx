import {
  UpdaterRendererProvider,
  useUpdaterView,
  type UpdaterRendererStateService,
} from '@setsuna-desktop/feature-updater/renderer';
import { Bell } from 'lucide-react';
import type { ReactNode } from 'react';
import { useI18n } from '../shared/i18n/I18nProvider.js';
import { IconButton } from '../shared/ui/primitives.js';

export function UpdaterFeatureServiceBoundary({
  children,
  service,
}: Readonly<{
  children: ReactNode;
  service: UpdaterRendererStateService;
}>) {
  return <UpdaterRendererProvider service={service}>{children}</UpdaterRendererProvider>;
}

/** Host placement for the updater-owned action in the shared top bar. */
export function UpdaterFeatureTopbarAction() {
  const { t } = useI18n();
  const updater = useUpdaterView(t);
  if (!updater.ready) return null;

  return (
    <IconButton
      label={updater.alertLabel}
      className="app-topbar-update-alert"
      disabled={updater.installing}
      onClick={() => void updater.promptReadyUpdate()}
    >
      <Bell size={15} />
      <span className="app-topbar-update-alert__badge" aria-hidden="true" />
    </IconButton>
  );
}
