import { X } from 'lucide-react';
import type { ReactElement } from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { ContextMenu } from '../../shared/ui/ContextMenu.js';
import type { DesktopPanelTab } from './model.js';

export function PanelTabContextMenu({ children, panel, panels, disabled, onClosePanels, onOpenChange }: {
  children: ReactElement;
  panel: DesktopPanelTab;
  panels: readonly DesktopPanelTab[];
  disabled?: boolean;
  onClosePanels(panelIds: readonly string[]): void;
  onOpenChange(open: boolean): void;
}) {
  const { t } = useI18n();
  const index = panels.findIndex((item) => item.id === panel.id);
  const actions = [
    ['workspace.panel.closeTab', [panel.id]],
    ['workspace.panel.closeOtherTabs', panels.filter((item) => item.id !== panel.id).map((item) => item.id)],
    ['workspace.panel.closeTabsToRight', panels.slice(index + 1).map((item) => item.id)],
    ['workspace.panel.closeAllTabs', panels.map((item) => item.id)],
  ] as const;

  return <ContextMenu trigger={['contextMenu']} disabled={disabled || index < 0} onOpenChange={onOpenChange}
    onContextMenu={(event) => event.stopPropagation()}
    menu={{ items: actions.map(([key, panelIds]) => ({
      key, label: t(key), icon: <X size={14} />, disabled: panelIds.length === 0,
      onClick: () => onClosePanels(panelIds),
    })) }}>
    {children}
  </ContextMenu>;
}
