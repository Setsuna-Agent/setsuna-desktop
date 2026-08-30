import type { ShellTopbarActionSlotProps } from '@setsuna-desktop/renderer-contracts/shell';
import { Bell } from 'lucide-react';
import type { UpdaterRendererStateService } from './service.js';
import { useUpdaterServiceView } from './view-model.js';

export function UpdaterTopbarAction({
  service,
  translate,
  ui,
}: ShellTopbarActionSlotProps & Readonly<{
  service: UpdaterRendererStateService;
}>) {
  const updater = useUpdaterServiceView(service, translate);
  if (!updater.ready) return null;
  return (
    <ui.IconButton
      className="app-topbar-update-alert"
      disabled={updater.installing}
      label={updater.alertLabel}
      onClick={() => void updater.promptReadyUpdate()}
    >
      <Bell size={15} />
      <span className="app-topbar-update-alert__badge" aria-hidden="true" />
    </ui.IconButton>
  );
}
