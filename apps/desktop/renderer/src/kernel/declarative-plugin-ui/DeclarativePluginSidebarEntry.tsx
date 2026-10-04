import { Button, Dropdown, Tooltip } from '@setsuna-desktop/renderer-ui';
import type { RuntimePluginAppReference, RuntimePluginSummary, RuntimePluginUiContribution } from '@setsuna-desktop/contracts';
import type { PluginManagementRendererService } from '@setsuna-desktop/feature-plugin-management/contracts';
import { Blocks, Pencil, SquarePen, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { PluginAppAppearanceDialog } from './app-appearance/PluginAppAppearanceDialog.js';
import { PluginAppAvatar } from './app-appearance/PluginAppAvatar.js';
import { usePluginAppAppearance } from './app-appearance/usePluginAppAppearance.js';
import { resolveRuntimePluginUiText, useDeclarativePluginUiData } from './useDeclarativePluginUiData.js';
import { DeletePluginAppDialog } from './DeletePluginAppDialog.js';
import { usePluginAppOrderEntry } from './app-order/PluginAppOrderProvider.js';

export function DeclarativePluginSidebarEntry({ active, contribution, entryId, missingContext, plugin, projectId, service, threadId, onOpen, onRemove, onViewPlugin, onModifyApp }: Readonly<{
  active: boolean;
  contribution: RuntimePluginUiContribution;
  entryId: string;
  missingContext: 'project' | 'thread' | null;
  plugin: RuntimePluginSummary;
  projectId?: string;
  service: PluginManagementRendererService;
  threadId?: string;
  onOpen(): void;
  onRemove(): Promise<void>;
  onViewPlugin(): void;
  onModifyApp(app: RuntimePluginAppReference): void;
}>) {
  const { t } = useI18n();
  const order = usePluginAppOrderEntry(entryId);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const handingOffFocus = useRef(false);
  const { appearance, save } = usePluginAppAppearance(plugin.id, contribution.id);
  const { data } = useDeclarativePluginUiData({ contribution, pluginId: plugin.id, projectId, service, threadId });
  const badge = missingContext
    ? t(missingContext === 'project' ? 'pluginUi.projectRequired' : 'pluginUi.threadRequired')
    : resolveRuntimePluginUiText(contribution.navigation?.badge, data);
  const defaultName = contribution.navigation?.label ?? plugin.name;
  const label = appearance.name ?? defaultName;
  return (
    <>
      <Tooltip title={badge ? `${label} · ${badge}` : label} placement="right" disabled={menuOpen || editing || deleting || order.dragging}>
        <Dropdown trigger={['contextMenu']} onOpenChange={setMenuOpen} onCloseAutoFocus={(event) => {
          if (!handingOffFocus.current) return;
          handingOffFocus.current = false;
          event.preventDefault();
        }} menu={{ items: [
          { key: 'edit', label: t('pluginUi.editApp'), icon: <Pencil size={14} />, onClick: () => setEditing(true) },
          { key: 'modify-plugin', label: t('pluginUi.modifyPlugin'), icon: <SquarePen size={14} />,
            onClick: () => {
              // The destination composer owns focus after this menu closes.
              handingOffFocus.current = true;
              onModifyApp({ pluginId: plugin.id, contributionId: contribution.id, name: label });
            } },
          { key: 'view-plugin', label: t('pluginUi.viewPlugin'), icon: <Blocks size={14} />, onClick: onViewPlugin },
          { type: 'divider' },
          { key: 'delete', label: t('common.delete'), icon: <Trash2 size={14} />, danger: true, onClick: () => setDeleting(true) },
        ] }}>
          <Button variant="ghost" className={`app-navigation__button${active ? ' is-active' : ''}`}
            {...order.buttonProps}
            onClick={onOpen} aria-label={label} aria-current={active ? 'page' : undefined} type="button">
            <PluginAppAvatar avatar={appearance.avatar} />
          </Button>
        </Dropdown>
      </Tooltip>
      {editing ? (
        <PluginAppAppearanceDialog appearance={appearance} defaultName={defaultName} pluginName={plugin.name}
          onClose={() => setEditing(false)} onSave={save} onViewPlugin={onViewPlugin} />
      ) : null}
      {deleting ? <DeletePluginAppDialog name={label} pluginName={plugin.name}
        onClose={() => setDeleting(false)} onRemove={onRemove} /> : null}
    </>
  );
}
