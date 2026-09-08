import type { SettingsViewUi } from '@setsuna-desktop/renderer-contracts/settings';
import { MessageSquare } from 'lucide-react';
import type { PluginManagementTranslate } from './messages.js';
import type { PluginUiSurface } from './pluginPresentation.js';

export function PluginUiPreviewDialog({
  onClose,
  surface,
  translate,
  ui,
}: Readonly<{
  onClose(): void;
  surface: PluginUiSurface;
  translate: PluginManagementTranslate;
  ui: SettingsViewUi;
}>) {
  const title = surface.title ?? surface.toolName ?? surface.id;
  const SandboxedUiFrame = ui.SandboxedUiFrame;
  return (
    <ui.Dialog
      className="desktop-plugin-ui-preview-dialog"
      closeLabel={translate('feature.pluginManagement.close')}
      footer={<ui.Button variant="secondary" onClick={onClose}>{translate('feature.pluginManagement.close')}</ui.Button>}
      onClose={onClose}
      size="large"
      subtitle={translate('feature.pluginManagement.interface.preview')}
      title={title}
      titleIcon={<MessageSquare size={17} />}
    >
      <div className="desktop-plugin-ui-preview-dialog__body">
        {surface.preview && SandboxedUiFrame ? (
          <>
            <p className="desktop-plugin-ui-preview-dialog__note">
              {translate('feature.pluginManagement.interface.previewSample')}
            </p>
            <SandboxedUiFrame
              className="desktop-plugin-ui-preview-dialog__frame"
              data={surface.preview.data}
              source={surface.preview}
              title={title}
            />
          </>
        ) : (
          <ui.EmptyState
            body={translate('feature.pluginManagement.interface.previewUnavailableBody')}
            title={translate('feature.pluginManagement.interface.previewUnavailableTitle')}
          />
        )}
      </div>
    </ui.Dialog>
  );
}
