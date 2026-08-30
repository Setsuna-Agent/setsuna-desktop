import type {
  RuntimePluginMarketplaceItem,
  RuntimePluginSummary,
} from '@setsuna-desktop/contracts';
import type { CapabilitiesRefreshCoordinator } from '@setsuna-desktop/renderer-contracts/capabilities';
import type { SettingsPageSlotProps } from '@setsuna-desktop/renderer-contracts/settings';
import {
  AlertTriangle,
  FolderPlus,
  Loader2,
  MessageSquare,
  PackageOpen,
  Power,
  PowerOff,
  RefreshCw,
  Search,
  ShieldCheck,
  ShieldOff,
  Trash2,
  Workflow,
} from 'lucide-react';
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import type {
  PluginManagementHook,
  PluginManagementRendererService,
} from '../contracts/index.js';
import type { PluginManagementTranslate } from './messages.js';
import { PluginDetail } from './PluginDetail.js';
import { PluginDetailSection } from './PluginDetailPrimitives.js';
import {
  installedPluginsOutsideCatalog,
  pluginMatchesQuery,
} from './pluginPresentation.js';

export function PluginCapabilitiesPage({
  capabilities,
  capabilitiesRefresh,
  openExternal,
  service,
  translate,
  ui,
}: SettingsPageSlotProps & Readonly<{
  capabilitiesRefresh: CapabilitiesRefreshCoordinator;
  openExternal(url: string): Promise<boolean>;
  service: PluginManagementRendererService;
}>) {
  const snapshot = useSyncExternalStore(
    (listener) => service.subscribe(listener),
    () => service.getSnapshot(),
    () => service.getSnapshot(),
  );
  const hookSnapshot = useSyncExternalStore(
    (listener) => service.subscribe(listener),
    () => service.getHookSnapshot(),
    () => service.getHookSnapshot(),
  );
  const [query, setQuery] = useState('');
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [legacyHooksOpen, setLegacyHooksOpen] = useState(false);
  const [selectedPluginId, setSelectedPluginId] = useState<string | null>(capabilities?.activeItemId ?? null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const t = translate as PluginManagementTranslate;

  useEffect(() => {
    if (snapshot.catalogRevision !== '__uninitialized__') return;
    void service.refresh().catch(() => undefined);
  }, [service, snapshot.catalogRevision]);

  useEffect(() => {
    void service.refreshHooks(capabilities?.workspacePath ? { cwd: capabilities.workspacePath } : {})
      .catch(() => undefined);
  }, [capabilities?.workspacePath, service]);

  useEffect(() => {
    if (capabilities?.activeItemId) setSelectedPluginId(capabilities.activeItemId);
  }, [capabilities?.activeItemId]);

  const installedById = useMemo(
    () => new Map(snapshot.plugins.map((plugin) => [plugin.id, plugin])),
    [snapshot.plugins],
  );
  const marketplaceById = useMemo(
    () => new Map(snapshot.marketplace.map((plugin) => [plugin.id, plugin])),
    [snapshot.marketplace],
  );
  const catalog = useMemo(() => snapshot.marketplace.filter((plugin) => (
    pluginMatchesQuery(plugin, query, installedById.get(plugin.id))
  )), [installedById, query, snapshot.marketplace]);
  const localPlugins = useMemo(() => installedPluginsOutsideCatalog(snapshot.plugins, snapshot.marketplace).filter((plugin) => (
    pluginMatchesQuery(plugin, query)
  )), [query, snapshot.marketplace, snapshot.plugins]);
  const selectedInstalled = selectedPluginId ? installedById.get(selectedPluginId) : undefined;
  const selectedMarketplace = selectedPluginId ? marketplaceById.get(selectedPluginId) : undefined;
  const standaloneHooks = hookSnapshot.hooks.filter((hook) => !hook.pluginId && !hook.isManaged);

  const openPlugin = (pluginId: string) => {
    setLegacyHooksOpen(false);
    setSelectedPluginId(pluginId);
    capabilities?.setActiveItemId(pluginId);
    setError(null);
  };
  const closePlugin = () => {
    setSelectedPluginId(null);
    capabilities?.setActiveItemId(null);
    setError(null);
  };
  const run = async (key: string, operation: () => Promise<unknown>, refreshCatalogs = false) => {
    if (pendingAction) return;
    setPendingAction(key);
    setError(null);
    try {
      await operation();
      if (refreshCatalogs) await capabilitiesRefresh.refresh(['skills', 'mcp']);
    } catch (unknownError) {
      setError(pluginErrorMessage(unknownError, t));
    } finally {
      setPendingAction(null);
    }
  };
  const installMarketplace = async (plugin: RuntimePluginMarketplaceItem) => run(
    `${plugin.updateAvailable ? 'update' : 'install'}:${plugin.id}`,
    () => plugin.updateAvailable
      ? service.updateMarketplace({ pluginId: plugin.id })
      : service.installMarketplace({ pluginId: plugin.id }),
    true,
  );
  const removePlugin = async (plugin: RuntimePluginSummary) => {
    if (!window.confirm(t('feature.pluginManagement.confirmRemove', { name: plugin.name }))) return;
    await run(`remove:${plugin.id}`, () => service.remove({ pluginId: plugin.id }), true);
    closePlugin();
  };
  const setExtensionTrust = async (plugin: RuntimePluginSummary, trusted: boolean) => {
    if (trusted && !window.confirm(t('feature.pluginManagement.confirmTrust', { name: plugin.name }))) return;
    await run(`trust:${plugin.id}`, () => service.setExtensionTrust({ pluginId: plugin.id, trusted }));
  };
  const setHookEnabled = (hook: PluginManagementHook, enabled: boolean) => run(
    `hook:${hook.managementId}`,
    () => service.setHookEnabled(hook, enabled),
  );
  const setHookTrust = async (hook: PluginManagementHook, trusted: boolean) => {
    if (trusted && !window.confirm(t('feature.pluginManagement.confirmHookTrust', {
      command: hookCommandSummary(hook),
    }))) return;
    await run(`hook:${hook.managementId}`, () => service.setHookTrust(hook, trusted));
  };
  const deleteStandaloneHook = async (hook: PluginManagementHook) => {
    if (!window.confirm(t('feature.pluginManagement.confirmDeleteHook', {
      name: hookDisplayName(hook),
    }))) return;
    await run(`hook:${hook.managementId}`, () => service.deleteStandaloneHook(hook));
  };

  if (selectedPluginId && (selectedInstalled || selectedMarketplace)) {
    return (
      <>
        <PluginDetail
          capabilities={capabilities}
          extensionStatus={snapshot.extensions.find((extension) => extension.pluginId === selectedPluginId)}
          hooks={hookSnapshot.hooks}
          installedPlugin={selectedInstalled}
          marketplacePlugin={selectedMarketplace}
          openExternal={openExternal}
          pendingAction={pendingAction}
          service={service}
          translate={t}
          ui={ui}
          useSkill={capabilities ? (skillId) => capabilities.openChat(skillId) : undefined}
          onBack={closePlugin}
          onInstall={installMarketplace}
          onRemove={removePlugin}
          onSetExtensionTrust={setExtensionTrust}
          onSetHookEnabled={setHookEnabled}
          onSetHookTrust={setHookTrust}
        />
        {error ? <ui.Toast message={error} tone="error" /> : null}
      </>
    );
  }

  if (legacyHooksOpen && standaloneHooks.length) {
    return (
      <>
        <LegacyHooksDetail
          capabilities={capabilities}
          hooks={standaloneHooks}
          pendingAction={pendingAction}
          translate={t}
          ui={ui}
          onBack={() => setLegacyHooksOpen(false)}
          onDeleteHook={deleteStandaloneHook}
          onSetHookEnabled={setHookEnabled}
          onSetHookTrust={setHookTrust}
        />
        {error ? <ui.Toast message={error} tone="error" /> : null}
      </>
    );
  }

  const installedMarketplacePlugins = catalog.filter((plugin) => installedById.has(plugin.id));
  const marketplaceSections = pluginMarketplaceSections(catalog, t);
  const installedCount = installedMarketplacePlugins.length + localPlugins.length + Number(standaloneHooks.length > 0);
  const hasPageErrors = snapshot.marketplaceErrors.length > 0 || Boolean(error);
  const tabsInPage = capabilities?.catalogNavigationInPage ?? false;
  return (
    <main className="capabilities-page desktop-capabilities-panel" data-feature-id="plugin-management">
      <section className={`desktop-capabilities-panel__inner desktop-capabilities-panel__inner--catalog desktop-capabilities-panel__inner--market${tabsInPage ? ' desktop-capabilities-panel__inner--page-tabs' : ''}${hasPageErrors ? ' desktop-capabilities-panel__inner--market-notice' : ''}`}>
        {capabilities?.catalogNavigation}
        <header className="desktop-capabilities-header desktop-capabilities-header--market">
          <div className="desktop-capabilities-title"><h2>{t('feature.pluginManagement.title')}</h2></div>
          <div className="desktop-capabilities-actions">
            <ui.IconButton
              label={t('feature.pluginManagement.refresh')}
              onClick={() => void run(
                'refresh',
                () => Promise.all([service.refresh(), service.refreshHooks()]),
              )}
            >
              <RefreshCw size={15} />
            </ui.IconButton>
            {capabilities ? capabilities.renderCreateMenu({
              busy: pendingAction === 'import',
              buttonLabel: t(pendingAction === 'import'
                ? 'feature.pluginManagement.importing'
                : 'feature.pluginManagement.create'),
              items: [
                {
                  description: t('feature.pluginManagement.createChatDescription'),
                  icon: <MessageSquare size={14} />,
                  id: 'chat-plugin',
                  onSelect: () => capabilities.openChat('create-plugin-in-chat'),
                  title: t('feature.pluginManagement.createChat'),
                },
                {
                  description: t('feature.pluginManagement.importDescription'),
                  disabled: pendingAction === 'import',
                  icon: <FolderPlus size={14} />,
                  id: 'import-plugin',
                  onSelect: () => void run('import', async () => {
                    const installed = await service.installLocal();
                    if (installed) openPlugin(installed.plugin.id);
                  }, true),
                  title: t('feature.pluginManagement.import'),
                },
              ],
              onOpenChange: setCreateMenuOpen,
              open: createMenuOpen,
            }) : (
              <ui.Button
                disabled={pendingAction === 'import'}
                icon={pendingAction === 'import' ? <Loader2 className="is-spinning" size={14} /> : <PackageOpen size={14} />}
                onClick={() => void run('import', () => service.installLocal(), true)}
              >
                {t(pendingAction === 'import' ? 'feature.pluginManagement.importing' : 'feature.pluginManagement.import')}
              </ui.Button>
            )}
          </div>
        </header>
        <div className="desktop-capabilities-search-row">
          <label className="desktop-capabilities-search">
            <Search size={14} />
            <input aria-label={t('feature.pluginManagement.search')} placeholder={t('feature.pluginManagement.search')} value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
          </label>
        </div>
        {hasPageErrors ? (
          <div className="desktop-capabilities-market-notices">
            {error ? <div className="desktop-capabilities-errors" role="alert">{error}</div> : null}
            {snapshot.marketplaceErrors.length ? (
              <div
                className="desktop-capabilities-market-warning"
                role="status"
                title={snapshot.marketplaceErrors.join('\n')}
              >
                <AlertTriangle aria-hidden="true" size={14} />
                <span>{t('feature.pluginManagement.partialUnavailable')}</span>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="desktop-capabilities-grid"><div className="desktop-capabilities-grid__content">
          <div className="desktop-plugin-market">
            {installedCount ? (
              <section className="desktop-plugin-market__installed" aria-label={t('feature.pluginManagement.installed')}>
                <header>
                  <h3>{t('feature.pluginManagement.installed')}</h3>
                  <span>{t('feature.pluginManagement.installedCount', { count: installedCount })}</span>
                </header>
                <div className="desktop-plugin-market__installed-list">
                  {installedMarketplacePlugins.map((plugin) => (
                    <InstalledPluginShortcut key={`installed-marketplace:${plugin.id}`} plugin={plugin} ui={ui} onOpen={() => openPlugin(plugin.id)} />
                  ))}
                  {localPlugins.map((plugin) => (
                    <InstalledPluginShortcut key={`installed-local:${plugin.id}`} plugin={plugin} ui={ui} onOpen={() => openPlugin(plugin.id)} />
                  ))}
                  {standaloneHooks.length ? (
                    <LegacyHooksShortcut
                      count={standaloneHooks.length}
                      translate={t}
                      ui={ui}
                      onOpen={() => setLegacyHooksOpen(true)}
                    />
                  ) : null}
                </div>
              </section>
            ) : null}
            <div className="desktop-plugin-market__catalog">
              {marketplaceSections.map((section) => (
                <PluginSection key={section.id} title={section.title}>
                  {section.plugins.map((plugin) => (
                    <PluginCard
                      installed={installedById.get(plugin.id)}
                      key={plugin.id}
                      marketplace={plugin}
                      pending={pendingAction?.endsWith(`:${plugin.id}`) ?? false}
                      translate={t}
                      ui={ui}
                      onInstall={() => installMarketplace(plugin)}
                      onOpen={() => openPlugin(plugin.id)}
                    />
                  ))}
                </PluginSection>
              ))}
              {!catalog.length && !localPlugins.length ? <div className="desktop-capabilities-empty">{t('feature.pluginManagement.empty')}</div> : null}
            </div>
          </div>
        </div></div>
      </section>
    </main>
  );
}

function PluginSection({ children, title }: Readonly<{ children: ReactNode; title: string }>) {
  return <section className="desktop-plugin-market__section"><header><h3>{title}</h3></header><div className="desktop-plugin-market__list desktop-capability-list">{children}</div></section>;
}

function InstalledPluginShortcut({ onOpen, plugin, ui }: Readonly<{
  onOpen(): void;
  plugin: RuntimePluginMarketplaceItem | RuntimePluginSummary;
  ui: SettingsPageSlotProps['ui'];
}>) {
  const updateAvailable = 'updateAvailable' in plugin && plugin.updateAvailable;
  return (
    <article className={`desktop-plugin-installed-shortcut${updateAvailable ? ' has-update' : ''}`}>
      <button aria-label={plugin.name} type="button" onClick={onOpen}>
        <ui.PluginIcon name={plugin.icon} pluginId={plugin.id} variant="installed" />
        {updateAvailable ? <span aria-hidden="true" className="desktop-plugin-installed-shortcut__update" /> : null}
      </button>
      <span aria-hidden="true" className="desktop-plugin-installed-shortcut__name">{plugin.name}</span>
    </article>
  );
}

function LegacyHooksShortcut({ count, onOpen, translate, ui }: Readonly<{
  count: number;
  onOpen(): void;
  translate: PluginManagementTranslate;
  ui: SettingsPageSlotProps['ui'];
}>) {
  const name = translate('feature.pluginManagement.legacyHooks');
  return (
    <article className="desktop-plugin-installed-shortcut">
      <button aria-label={name} title={`${name} · ${count}`} type="button" onClick={onOpen}>
        <ui.PluginIcon pluginId="setsuna-legacy-hooks" variant="installed" />
      </button>
      <span aria-hidden="true" className="desktop-plugin-installed-shortcut__name">{name}</span>
    </article>
  );
}

function PluginCard({ installed, marketplace, onInstall, onOpen, pending, translate, ui }: Readonly<{
  installed: RuntimePluginSummary | undefined;
  marketplace?: RuntimePluginMarketplaceItem;
  onInstall?: () => Promise<void>;
  onOpen(): void;
  pending: boolean;
  translate: PluginManagementTranslate;
  ui: SettingsPageSlotProps['ui'];
}>) {
  const plugin = marketplace ?? installed;
  if (!plugin) return null;
  const updateAvailable = Boolean(marketplace?.updateAvailable && onInstall);
  const installedWithoutUpdate = Boolean(installed && !updateAvailable);
  const actionLabel = pending
    ? translate(updateAvailable ? 'feature.pluginManagement.updating' : 'feature.pluginManagement.getting')
    : translate(updateAvailable
      ? 'feature.pluginManagement.update'
      : installedWithoutUpdate
        ? 'feature.pluginManagement.installed'
        : 'feature.pluginManagement.install');
  return (
    <article className="desktop-capability-list-item">
      <button className="desktop-capability-list-item__identity" type="button" onClick={onOpen}>
        <ui.PluginIcon name={plugin.icon} pluginId={plugin.id} variant="list" />
        <span className="desktop-capability-list-item__copy"><strong>{plugin.name}</strong><span>{plugin.description ?? plugin.id}</span></span>
      </button>
      <button
        aria-label={`${actionLabel}: ${plugin.name}`}
        className={`desktop-plugin-market__get${installedWithoutUpdate ? ' is-installed' : ''}`}
        disabled={pending || installedWithoutUpdate || !onInstall}
        type="button"
        onClick={() => void onInstall?.()}
      >
        {pending ? <Loader2 className="is-spinning" size={13} /> : null}
        <span>{actionLabel}</span>
      </button>
    </article>
  );
}

function LegacyHooksDetail({
  capabilities,
  hooks,
  onBack,
  onDeleteHook,
  onSetHookEnabled,
  onSetHookTrust,
  pendingAction,
  translate,
  ui,
}: Readonly<{
  capabilities?: SettingsPageSlotProps['capabilities'];
  hooks: readonly PluginManagementHook[];
  onBack(): void;
  onDeleteHook(hook: PluginManagementHook): Promise<void>;
  onSetHookEnabled(hook: PluginManagementHook, enabled: boolean): Promise<void>;
  onSetHookTrust(hook: PluginManagementHook, trusted: boolean): Promise<void>;
  pendingAction: string | null;
  translate: PluginManagementTranslate;
  ui: SettingsPageSlotProps['ui'];
}>) {
  return (
    <main className="capabilities-page desktop-capabilities-panel" data-feature-id="plugin-management">
      <section className="desktop-capabilities-panel__inner desktop-capabilities-panel__inner--detail">
        {capabilities?.renderBreadcrumb({
          currentLabel: translate('feature.pluginManagement.legacyHooks'),
          parentLabel: translate('feature.pluginManagement.title'),
          onBack,
        })}
        <section className="desktop-capabilities-detail desktop-capabilities-plugin-detail desktop-capabilities-legacy-hooks">
          <ui.PageHeader
            subtitle={translate('feature.pluginManagement.legacyHooksDescription')}
            title={translate('feature.pluginManagement.legacyHooks')}
          />
          <div className="desktop-capabilities-usage-note">
            <AlertTriangle aria-hidden="true" size={14} />
            <span>{translate('feature.pluginManagement.legacyHooksMigrationHint')}</span>
          </div>
          <PluginDetailSection count={hooks.length} icon={<Workflow size={15} />} title={translate('feature.pluginManagement.hooks')}>
            {hooks.map((hook) => {
              const pending = pendingAction === `hook:${hook.managementId}`;
              const trusted = hook.trustStatus === 'trusted';
              return (
                <div className="desktop-capabilities-plugin-detail__item is-static" key={hook.managementId}>
                  <span className="desktop-capabilities-plugin-detail__item-icon"><Workflow size={16} /></span>
                  <span className="desktop-capabilities-plugin-detail__item-body"><strong>{hook.eventName}{hook.matcher ? ` · ${hook.matcher}` : ''}</strong><small>{hook.command ?? hook.statusMessage ?? hook.source}</small></span>
                  <span className="desktop-capabilities-legacy-hooks__actions">
                    {pending ? <Loader2 className="is-spinning" size={14} /> : (
                      <>
                        <ui.IconButton label={translate(trusted ? 'feature.pluginManagement.untrustHook' : 'feature.pluginManagement.trustHook')} onClick={() => void onSetHookTrust(hook, !trusted)}>{trusted ? <ShieldOff size={14} /> : <ShieldCheck size={14} />}</ui.IconButton>
                        <ui.IconButton label={translate(hook.enabled ? 'feature.pluginManagement.disableHook' : 'feature.pluginManagement.enableHook')} onClick={() => void onSetHookEnabled(hook, !hook.enabled)}>{hook.enabled ? <PowerOff size={14} /> : <Power size={14} />}</ui.IconButton>
                        <ui.IconButton label={translate('feature.pluginManagement.deleteHook')} variant="danger" onClick={() => void onDeleteHook(hook)}><Trash2 size={14} /></ui.IconButton>
                      </>
                    )}
                  </span>
                </div>
              );
            })}
          </PluginDetailSection>
        </section>
      </section>
    </main>
  );
}

function hookDisplayName(hook: PluginManagementHook): string {
  return hook.matcher ? `${hook.eventName} · ${hook.matcher}` : hook.eventName;
}

function hookCommandSummary(hook: PluginManagementHook): string {
  return hook.command ?? hook.statusMessage ?? hookDisplayName(hook);
}

function pluginErrorMessage(error: unknown, translate: PluginManagementTranslate): string {
  const detail = error instanceof Error ? error.message : String(error);
  return translate('feature.pluginManagement.withDetail', {
    detail,
    fallback: translate('feature.pluginManagement.error.generic'),
  });
}

function pluginMarketplaceSections(
  plugins: readonly RuntimePluginMarketplaceItem[],
  translate: PluginManagementTranslate,
) {
  const utilities = plugins.filter((plugin) => plugin.publisher === 'Setsuna' && plugin.capabilities.extension);
  const regular = plugins.filter((plugin) => !utilities.includes(plugin));
  const featured = regular.filter((plugin) => plugin.featured);
  const catalog = regular.filter((plugin) => !plugin.featured);
  const creation = catalog.filter((plugin) => !plugin.capabilities.hooks);
  const automation = catalog.filter((plugin) => plugin.capabilities.hooks > 0);
  return [
    { id: 'featured', plugins: featured, title: translate('feature.pluginManagement.marketplace.featured') },
    { id: 'utilities', plugins: utilities, title: translate('feature.pluginManagement.marketplace.utilities') },
    { id: 'creation', plugins: creation, title: translate('feature.pluginManagement.marketplace.creation') },
    { id: 'automation', plugins: automation, title: translate('feature.pluginManagement.marketplace.automation') },
  ].filter((section) => section.plugins.length > 0);
}
