import { useConfirm } from '@setsuna-desktop/renderer-ui';
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
  const confirm = useConfirm();
  if (!updater.ready) return null;
  return (
    <ui.IconButton
      className="app-topbar-update-alert"
      disabled={updater.installing}
      label={updater.alertLabel}
      onClick={async () => {
        const state = updater.state;
        if (!state) return;
        const accepted = await confirm({
          title: updater.statusTitle,
          description: translate(state.platform === 'darwin' ? 'feature.updater.ready.macDetail'
            : state.platform === 'win32' ? 'feature.updater.ready.windowsDetail' : 'feature.updater.ready.detail', {
            name: state.assetName ?? translate('feature.updater.ready.package'),
          }),
          confirmLabel: updater.installButtonText,
          cancelLabel: translate('feature.updater.ready.later'),
        });
        if (accepted) await updater.installReadyUpdate();
      }}
    >
      <Bell size={15} />
      <span className="app-topbar-update-alert__badge" aria-hidden="true" />
    </ui.IconButton>
  );
}
