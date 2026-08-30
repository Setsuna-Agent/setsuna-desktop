import {
  BrowserPanel,
  type BrowserNotify,
  type BrowserScreenshotAttachmentHandler,
} from '@setsuna-desktop/feature-browser/renderer';
import { useCallback, type PointerEvent as ReactPointerEvent } from 'react';
import { useToast } from '../app/providers/ToastProvider.js';
import type {
  DesktopPanelSlot,
  DesktopPanelTab,
  DesktopPanelTabPatch,
} from '../features/workspace/model.js';
import { WorkspaceResizeHandle } from '../features/workspace/WorkspaceResizeHandle.js';
import { useI18n } from '../shared/i18n/I18nProvider.js';
import { useKeyboardShortcuts } from '../shared/shortcuts/KeyboardShortcutsProvider.js';
import { SelectField } from '../shared/ui/primitives.js';

export function BrowserFeaturePane({
  hidden,
  panel,
  placement = 'side',
  onPanelMetadataChange,
  onResizeStep,
  onResizeStart,
  onScreenshotAttachment,
  resizeMax,
  resizeMin,
  resizeValue,
}: Readonly<{
  hidden: boolean;
  panel: DesktopPanelTab;
  placement?: DesktopPanelSlot;
  onPanelMetadataChange: (panelId: string, patch: DesktopPanelTabPatch) => void;
  onResizeStep: (delta: number) => void;
  onResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onScreenshotAttachment?: BrowserScreenshotAttachmentHandler;
  resizeMax: number;
  resizeMin: number;
  resizeValue: number;
}>) {
  const { t } = useI18n();
  const { bindingsFor } = useKeyboardShortcuts();
  const toast = useToast();
  const notify = useCallback<BrowserNotify>((tone, message) => {
    toast.show(message, { tone });
  }, [toast]);

  return (
    <BrowserPanel
      bridge={window.setsunaDesktop?.browser ?? null}
      hidden={hidden}
      notify={notify}
      openExternal={(url) => { void window.setsunaDesktop?.links.openExternal(url); }}
      panel={{ browser: panel.browser, id: panel.id, title: panel.title }}
      placement={placement}
      reloadShortcutBindings={{
        hard: bindingsFor('browser.hardReload')[0] ?? null,
        normal: bindingsFor('browser.reload')[0] ?? null,
      }}
      resizeHandle={(
        <WorkspaceResizeHandle
          max={resizeMax}
          min={resizeMin}
          value={resizeValue}
          onResizeStart={onResizeStart}
          onResizeStep={onResizeStep}
        />
      )}
      selectField={SelectField}
      translate={t}
      onPanelMetadataChange={onPanelMetadataChange}
      onScreenshotAttachment={onScreenshotAttachment}
    />
  );
}
