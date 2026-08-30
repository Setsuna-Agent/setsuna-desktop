import type {
  RuntimeExtensionStatus,
  RuntimePluginMarketplaceItem,
  RuntimePluginSummary,
} from '@setsuna-desktop/contracts';
import type {
  CapabilitiesPageNavigation,
  SettingsViewUi,
} from '@setsuna-desktop/renderer-contracts/settings';
import {
  AlertTriangle,
  BookOpen,
  Check,
  Download,
  FileText,
  Loader2,
  MessageSquare,
  Plug,
  ShieldCheck,
  ShieldOff,
  Trash2,
  Workflow,
  Wrench,
} from 'lucide-react';
import { useState } from 'react';
import type {
  PluginManagementHook,
  PluginManagementRendererService,
} from '../contracts/index.js';
import type { PluginManagementTranslate } from './messages.js';
import {
  PluginDetailItem,
  PluginDetailItemIcon,
  PluginDetailSection,
} from './PluginDetailPrimitives.js';
import { PluginItemDialog, type PluginDetailItem as SelectedPluginItem } from './PluginItemDialog.js';
import {
  formatPluginFileSize,
  mergePluginHooks,
  mergePluginMcpServers,
  mergePluginSkills,
  mergePluginTools,
} from './pluginPresentation.js';

export function PluginDetail({
  capabilities,
  extensionStatus,
  hooks,
  installedPlugin,
  marketplacePlugin,
  openExternal,
  onBack,
  onInstall,
  onRemove,
  onSetExtensionTrust,
  onSetHookEnabled,
  onSetHookTrust,
  pendingAction,
  service,
  translate,
  ui,
  useSkill,
}: Readonly<{
  capabilities?: CapabilitiesPageNavigation;
  extensionStatus?: RuntimeExtensionStatus;
  hooks: readonly PluginManagementHook[];
  installedPlugin?: RuntimePluginSummary;
  marketplacePlugin?: RuntimePluginMarketplaceItem;
  openExternal(url: string): Promise<boolean>;
  onBack(): void;
  onInstall(plugin: RuntimePluginMarketplaceItem): Promise<void>;
  onRemove(plugin: RuntimePluginSummary): Promise<void>;
  onSetExtensionTrust(plugin: RuntimePluginSummary, trusted: boolean): Promise<void>;
  onSetHookEnabled(hook: PluginManagementHook, enabled: boolean): Promise<void>;
  onSetHookTrust(hook: PluginManagementHook, trusted: boolean): Promise<void>;
  pendingAction: string | null;
  service: PluginManagementRendererService;
  translate: PluginManagementTranslate;
  ui: SettingsViewUi;
  useSkill?(skillId: string): void;
}>) {
  const [selectedItem, setSelectedItem] = useState<SelectedPluginItem | null>(null);
  const plugin = installedPlugin ?? marketplacePlugin;
  if (!plugin) return null;
  const includeCatalogOnly = !installedPlugin;
  const tools = mergePluginTools(marketplacePlugin?.tools ?? [], installedPlugin?.tools ?? [], includeCatalogOnly);
  const skills = mergePluginSkills(marketplacePlugin?.skills ?? [], installedPlugin?.skills ?? [], includeCatalogOnly);
  const mcpServers = mergePluginMcpServers(marketplacePlugin?.mcpServers ?? [], installedPlugin?.mcpServers ?? [], includeCatalogOnly);
  const pluginHooks = mergePluginHooks(marketplacePlugin?.hooks ?? [], installedPlugin?.hooks ?? [], includeCatalogOnly);
  const resources = installedPlugin?.resources ?? marketplacePlugin?.resources ?? [];
  const hookCount = installedPlugin
    ? Math.max(pluginHooks.length, installedPlugin.hookCount)
    : Math.max(pluginHooks.length, marketplacePlugin?.capabilities.hooks ?? 0);
  const resourceCount = installedPlugin
    ? resources.length
    : Math.max(resources.length, marketplacePlugin?.capabilities.resources ?? 0);
  const pending = pendingAction?.endsWith(`:${plugin.id}`) ?? false;
  const localExtension = installedPlugin?.installationSource !== 'marketplace'
    ? installedPlugin?.extension
    : undefined;
  const extensionTrusted = localExtension?.trust === 'trusted';
  const subtitle = [plugin.publisher, plugin.version ? `v${plugin.version}` : null].filter(Boolean).join(' · ');
  const actionItems = [
    ...(marketplacePlugin?.updateAvailable ? [{
      disabled: pending,
      icon: pending ? <Loader2 className="is-spinning" size={14} /> : <Download size={14} />,
      id: 'update',
      label: marketplacePlugin.version
        ? translate('feature.pluginManagement.updateTo', { version: marketplacePlugin.version })
        : translate('feature.pluginManagement.updatePlugin'),
    }] : []),
    {
      danger: true,
      disabled: pending,
      icon: pending ? <Loader2 className="is-spinning" size={14} /> : <Trash2 size={14} />,
      id: 'uninstall',
      label: translate(pending
        ? 'feature.pluginManagement.uninstalling'
        : 'feature.pluginManagement.uninstall'),
    },
    {
      disabled: !skills[0] || !useSkill,
      icon: <MessageSquare size={14} />,
      id: 'use-in-conversation',
      label: translate('feature.pluginManagement.useSkill'),
    },
  ];
  const selectAction = (actionId: string) => {
    if (actionId === 'update' && marketplacePlugin) void onInstall(marketplacePlugin);
    if (actionId === 'uninstall' && installedPlugin) void onRemove(installedPlugin);
    if (actionId === 'use-in-conversation' && skills[0]) useSkill?.(skills[0].id);
  };

  return (
    <main className="capabilities-page desktop-capabilities-panel" data-feature-id="plugin-management">
      <section className="desktop-capabilities-panel__inner desktop-capabilities-panel__inner--detail">
        {capabilities?.renderBreadcrumb({
          currentLabel: plugin.name,
          parentLabel: translate('feature.pluginManagement.title'),
          onBack,
        })}
        <section className="desktop-capabilities-detail desktop-capabilities-plugin-detail">
          <ui.PageHeader
            actions={installedPlugin ? (
              <ui.ActionMenu
                items={actionItems}
                label={translate('feature.pluginManagement.actions')}
                onSelect={selectAction}
              />
            ) : marketplacePlugin ? (
              <ui.Button
                disabled={pending}
                icon={pending ? <Loader2 className="is-spinning" size={14} /> : <Download size={14} />}
                variant="primary"
                onClick={() => void onInstall(marketplacePlugin)}
              >
                {translate(pending
                  ? 'feature.pluginManagement.installing'
                  : 'feature.pluginManagement.detailInstall')}
              </ui.Button>
            ) : (
              <ui.Button disabled icon={<Check size={14} />} variant="ghost">
                {translate('feature.pluginManagement.installed')}
              </ui.Button>
            )}
            className="desktop-capabilities-plugin-detail__header"
            leading={<ui.PluginIcon name={plugin.icon} pluginId={plugin.id} variant="list" />}
            subtitle={subtitle}
            title={plugin.name}
          />

          <p className="desktop-capabilities-plugin-detail__description">{plugin.description ?? plugin.id}</p>

          {localExtension ? (
            <section className="desktop-capabilities-plugin-detail__extension">
              <div className="desktop-capabilities-plugin-detail__extension-copy">
                <span className={`desktop-capabilities-plugin-detail__extension-icon${extensionTrusted ? ' is-trusted' : ''}`}>
                  {extensionTrusted
                    ? <ShieldCheck aria-hidden="true" size={19} />
                    : <AlertTriangle aria-hidden="true" size={19} />}
                </span>
                <div>
                  <strong>{translate('feature.pluginManagement.extension')}</strong>
                  <small>{localExtension.capabilities.join(' · ')}</small>
                  {extensionStatus?.error ? <small className="is-error">{extensionStatus.error}</small> : null}
                </div>
              </div>
              <ui.Button
                disabled={pending}
                variant={extensionTrusted ? 'secondary' : 'primary'}
                icon={extensionTrusted ? <ShieldOff size={14} /> : <ShieldCheck size={14} />}
                onClick={() => void onSetExtensionTrust(installedPlugin!, !extensionTrusted)}
              >
                {translate(extensionTrusted ? 'feature.pluginManagement.revokeTrust' : 'feature.pluginManagement.trust')}
              </ui.Button>
            </section>
          ) : null}

          {installedPlugin?.installationSource === 'marketplace' ? <ui.PageOutlet sectionId={plugin.id} /> : null}

          <PluginDetailSection count={tools.length} icon={<Wrench size={15} />} title={translate('feature.pluginManagement.tools')}>
            {tools.map((tool) => (
              <PluginDetailItem
                badges={[translate('feature.pluginManagement.runtimeTool')]}
                description={tool.description ?? tool.name}
                icon={<PluginDetailItemIcon><Wrench size={16} /></PluginDetailItemIcon>}
                key={tool.name}
                title={tool.name}
                viewLabel={translate('feature.pluginManagement.viewItem', { title: tool.name })}
              />
            ))}
          </PluginDetailSection>
          <PluginDetailSection count={skills.length} icon={<BookOpen size={15} />} title={translate('feature.pluginManagement.skills')}>
            {skills.map((skill) => (
              <PluginDetailItem
                description={skill.description ?? skill.id}
                icon={<ui.PluginIcon name={plugin.icon} pluginId={plugin.id} variant="list" />}
                key={skill.id}
                title={skill.name}
                viewLabel={translate('feature.pluginManagement.viewItem', { title: skill.name })}
                onClick={() => setSelectedItem({ kind: 'skill', value: skill })}
              />
            ))}
          </PluginDetailSection>
          <PluginDetailSection count={mcpServers.length} icon={<Plug size={15} />} title={translate('feature.pluginManagement.mcpServers')}>
            {mcpServers.map((server) => (
              <PluginDetailItem
                badges={[
                  translate(server.transport === 'streamableHttp'
                    ? 'feature.pluginManagement.mcp.remote'
                    : 'feature.pluginManagement.mcp.local'),
                  ...(server.owned === false ? [translate('feature.pluginManagement.mcp.reuse')] : []),
                ]}
                description={server.description ?? server.key}
                icon={<PluginDetailItemIcon kind="mcp"><Plug size={16} /></PluginDetailItemIcon>}
                key={server.key}
                title={server.label}
                viewLabel={translate('feature.pluginManagement.viewItem', { title: server.label })}
                onClick={() => setSelectedItem({ kind: 'mcp', value: server })}
              />
            ))}
          </PluginDetailSection>
          <PluginDetailSection count={hookCount} icon={<Workflow size={15} />} title={translate('feature.pluginManagement.hooks')}>
            {pluginHooks.map((hook) => (
              <PluginDetailItem
                description={hook.description ?? hook.statusMessage ?? hook.id}
                icon={<PluginDetailItemIcon><Workflow size={16} /></PluginDetailItemIcon>}
                key={hook.id}
                title={hook.name}
                viewLabel={translate('feature.pluginManagement.viewItem', { title: hook.name })}
                onClick={() => setSelectedItem({ kind: 'hook', value: hook })}
              />
            ))}
            {hookCount > pluginHooks.length ? (
              <p className="desktop-capabilities-plugin-detail__empty">
                {translate('feature.pluginManagement.legacyHooksHidden', { count: hookCount - pluginHooks.length })}
              </p>
            ) : null}
          </PluginDetailSection>
          <PluginDetailSection count={resourceCount} icon={<FileText size={15} />} title={translate('feature.pluginManagement.resources')}>
            {resources.map((resource) => (
              <PluginDetailItem
                badges={[formatPluginFileSize(resource.size)]}
                description={resource.path}
                icon={<PluginDetailItemIcon><FileText size={16} /></PluginDetailItemIcon>}
                key={resource.id}
                title={resource.label}
                viewLabel={translate('feature.pluginManagement.viewItem', { title: resource.label })}
                onClick={() => setSelectedItem({ kind: 'resource', value: resource })}
              />
            ))}
            {resourceCount > resources.length ? (
              <p className="desktop-capabilities-plugin-detail__empty">
                {translate('feature.pluginManagement.resourcesAfterInstall', { count: resourceCount })}
              </p>
            ) : null}
          </PluginDetailSection>
        </section>
      </section>
      {selectedItem ? (
        <PluginItemDialog
          hooks={hooks}
          installed={Boolean(installedPlugin)}
          item={selectedItem}
          openExternal={openExternal}
          pluginId={plugin.id}
          service={service}
          translate={translate}
          ui={ui}
          onClose={() => setSelectedItem(null)}
          onSetHookEnabled={onSetHookEnabled}
          onSetHookTrust={onSetHookTrust}
        />
      ) : null}
    </main>
  );
}
