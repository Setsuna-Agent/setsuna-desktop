import type {
  RuntimeConfigState,
  RuntimeExtensionStatus,
  RuntimeHookListResponse,
  RuntimeHookMetadata,
  RuntimeImageGenerationConfigInput,
  RuntimeImageGenerationTestInput,
  RuntimeImageGenerationTestResult,
  RuntimeVisionRecognitionConfigInput,
  RuntimeVisionRecognitionTestInput,
  RuntimeVisionRecognitionTestResult,
  RuntimeMcpServer,
  RuntimeMcpServerInput,
  RuntimeMcpServerList,
  RuntimeMcpToolInfo,
  RuntimePluginItemContent,
  RuntimePluginItemKind,
  RuntimePluginInstallResult,
  RuntimePluginMarketplaceItem,
  RuntimePluginSummary,
  RuntimeSkillDetail,
  RuntimeSkillInput,
  RuntimeSkillSummary,
} from '@setsuna-desktop/contracts';
import {
  AlertTriangle,
  FilePlus2,
  MessageSquare,
  Plug,
  RefreshCw,
  Search,
} from 'lucide-react';
import { useCallback, useState } from 'react';
import { translate, useI18n, type Translate } from '../../shared/i18n/I18nProvider.js';
import { getDesktopPlatform } from '../../shared/lib/desktopPlatform.js';
import { AppRouteTopbarPortal } from '../../shared/ui/AppRouteTopbarPortal.js';
import { IconButton } from '../../shared/ui/primitives.js';
import {
  CapabilitiesMcpListItem,
} from './CapabilitiesCatalogItems.js';
import {
  CapabilitiesCreateMenu,
  CapabilitiesPluginCreateMenu,
} from './CapabilitiesCreateMenu.js';
import { CapabilitiesPluginDetail } from './CapabilitiesPluginDetail.js';
import { CapabilitiesLegacyHooksDetail } from './CapabilitiesLegacyHooksDetail.js';
import { CapabilitiesPluginMarket } from './CapabilitiesPluginMarket.js';
import { CapabilitiesSkillDetail } from './CapabilitiesSkillDetail.js';
import { CapabilitiesSkillEditor } from './CapabilitiesSkillEditor.js';
import { CapabilitiesSkillCatalog } from './CapabilitiesSkillCatalog.js';
import { installedPluginsOutsideCatalog, pluginMatchesQuery } from './pluginDisplay.js';
import { CapabilitiesMcpEditor } from './mcp/CapabilitiesMcpEditor.js';
import { CapabilitiesMcpDetail } from './mcp/CapabilitiesMcpDetail.js';
import {
  emptyMcpDraft,
  mcpDraftToInput,
  type McpDraft,
} from './mcp/mcp-editor-model.js';
import { useCapabilitySkillDetails } from './useCapabilitySkillDetails.js';

const defaultTranslate: Translate = (key, params) => translate('zh-CN', key, params);

const chatCreateSkillIds = {
  mcp: 'create-mcp-in-chat',
  plugins: 'create-plugin-in-chat',
  skills: 'create-skill-in-chat',
} as const;

export const capabilityTabIds = ['plugins', 'skills', 'mcp'] as const;
export type CapabilityFilter = (typeof capabilityTabIds)[number];

export function capabilityCatalogTitle(
  filter: CapabilityFilter,
  t: Translate = defaultTranslate,
): string {
  if (filter === 'plugins') return t('capabilities.title.marketplace');
  if (filter === 'skills') return t('capabilities.tab.skills');
  return 'MCP';
}

export function CapabilitiesPage({
  config,
  skills,
  mcpState,
  hookState,
  plugins,
  pluginMarketplace,
  pluginMarketplaceErrors,
  extensionStatuses,
  selectedPluginId,
  onCreateSkill,
  onDeleteSkill,
  onGetPluginItemContent,
  onGetSkillDetail,
  onInstallSkillMcpDependencies,
  onAuthenticateSkillMcpDependency,
  onCreateInConversation,
  onRefresh,
  onUpdateSkill,
  onFetchMcpTools,
  onSaveMcpServer,
  onUpdateMcpServer,
  onDeleteMcpServer,
  onLoginMcpServer,
  onLogoutMcpServer,
  onInstallLocalPlugin,
  onInstallMarketplacePlugin,
  onUpdateMarketplacePlugin,
  onRemovePlugin,
  onSetPluginExtensionTrust,
  onDeleteStandaloneHook,
  onSetHookEnabled,
  onSetHookTrust,
  onSelectedPluginIdChange,
  onSaveImageGenerationConfig,
  onTestImageGeneration,
  onSaveVisionRecognitionConfig,
  onTestVisionRecognition,
}: {
  config: RuntimeConfigState | null;
  skills: RuntimeSkillSummary[];
  mcpState: RuntimeMcpServerList | null;
  hookState: RuntimeHookListResponse | null;
  plugins: RuntimePluginSummary[];
  pluginMarketplace: RuntimePluginMarketplaceItem[];
  pluginMarketplaceErrors: string[];
  extensionStatuses: RuntimeExtensionStatus[];
  selectedPluginId: string | null;
  onCreateSkill: (input: RuntimeSkillInput) => Promise<RuntimeSkillDetail>;
  onDeleteSkill: (skill: RuntimeSkillSummary) => Promise<void>;
  onGetPluginItemContent: (pluginId: string, kind: RuntimePluginItemKind, itemId: string, source: 'installed' | 'marketplace') => Promise<RuntimePluginItemContent>;
  onGetSkillDetail: (skillId: string) => Promise<RuntimeSkillDetail>;
  onInstallSkillMcpDependencies: (skill: RuntimeSkillSummary) => Promise<RuntimeSkillDetail>;
  onAuthenticateSkillMcpDependency: (skill: RuntimeSkillSummary, serverKey: string) => Promise<RuntimeSkillDetail>;
  onCreateInConversation: (skillId: string) => void;
  onRefresh: () => Promise<void>;
  onUpdateSkill: (skill: RuntimeSkillSummary, patch: Partial<RuntimeSkillInput>) => Promise<RuntimeSkillDetail>;
  onFetchMcpTools: (input: RuntimeMcpServerInput) => Promise<{ tools: RuntimeMcpToolInfo[]; errors: string[] }>;
  onSaveMcpServer: (input: RuntimeMcpServerInput) => Promise<void>;
  onUpdateMcpServer: (server: RuntimeMcpServer, patch: Pick<RuntimeMcpServer, 'enabled'>) => Promise<void>;
  onDeleteMcpServer: (server: RuntimeMcpServer) => Promise<void>;
  onLoginMcpServer: (server: RuntimeMcpServer) => Promise<void>;
  onLogoutMcpServer: (server: RuntimeMcpServer) => Promise<void>;
  onInstallLocalPlugin: () => Promise<RuntimePluginInstallResult | null>;
  onInstallMarketplacePlugin: (pluginId: string) => Promise<unknown>;
  onUpdateMarketplacePlugin: (pluginId: string) => Promise<unknown>;
  onRemovePlugin: (pluginId: string) => Promise<void>;
  onSetPluginExtensionTrust: (pluginId: string, trusted: boolean) => Promise<void>;
  onDeleteStandaloneHook: (hook: RuntimeHookMetadata) => Promise<void>;
  onSetHookEnabled: (hook: RuntimeHookMetadata, enabled: boolean) => Promise<void>;
  onSetHookTrust: (hook: RuntimeHookMetadata, trusted: boolean) => Promise<void>;
  onSelectedPluginIdChange: (pluginId: string | null) => void;
  onSaveImageGenerationConfig: (input: RuntimeImageGenerationConfigInput) => Promise<void>;
  onTestImageGeneration: (input: RuntimeImageGenerationTestInput) => Promise<RuntimeImageGenerationTestResult>;
  onSaveVisionRecognitionConfig: (input: RuntimeVisionRecognitionConfigInput) => Promise<void>;
  onTestVisionRecognition: (input: RuntimeVisionRecognitionTestInput) => Promise<RuntimeVisionRecognitionTestResult>;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<McpDraft>(emptyMcpDraft);
  const [saving, setSaving] = useState(false);
  const [capabilityFilter, setCapabilityFilter] = useState<CapabilityFilter>('plugins');
  const [capabilityQuery, setCapabilityQuery] = useState('');
  const [mcpAuthPendingKeys, setMcpAuthPendingKeys] = useState<Set<string>>(new Set());
  const [mcpEditorOpen, setMcpEditorOpen] = useState(false);
  const [selectedMcpServerKey, setSelectedMcpServerKey] = useState<string | null>(null);
  const [installingLocalPlugin, setInstallingLocalPlugin] = useState(false);
  const [installingPluginIds, setInstallingPluginIds] = useState<Set<string>>(new Set());
  const [removingPluginIds, setRemovingPluginIds] = useState<Set<string>>(new Set());
  const [pluginError, setPluginError] = useState<string | null>(null);
  const [trustingExtensionIds, setTrustingExtensionIds] = useState<Set<string>>(new Set());
  const [editingMcpServer, setEditingMcpServer] = useState<RuntimeMcpServer | null>(null);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [legacyHooksOpen, setLegacyHooksOpen] = useState(false);
  const skillDetails = useCapabilitySkillDetails({
    onCreateSkill,
    onDeleteSkill,
    onGetSkillDetail,
    onUpdateSkill,
  });
  const {
    detail: skillDetail,
    error: skillDetailError,
    loading: skillDetailLoading,
    mode: skillPageMode,
    pendingDependencyKeys: skillDependencyPendingKeys,
    saving: skillSaving,
    summary: skillDetailSummary,
  } = skillDetails;
  const servers = mcpState?.servers ?? [];
  const selectedMcpServer = selectedMcpServerKey
    ? servers.find((server) => server.key === selectedMcpServerKey)
    : undefined;
  const hookEntries = hookState?.data ?? [];
  const hooks = hookEntries.flatMap((entry) => entry.hooks.map((hook) => ({ ...hook, cwd: entry.cwd })));
  const standaloneHooks = hooks.filter((hook) => hook.source === 'user' && !hook.pluginId);
  const enabledSkillCount = skills.filter((skill) => skill.enabled).length;
  const normalizedCapabilityQuery = capabilityQuery.trim().toLowerCase();
  const visibleServers = servers.filter((server) =>
    !normalizedCapabilityQuery ||
    `${server.label} ${server.key} ${server.transport}`.toLowerCase().includes(normalizedCapabilityQuery),
  );
  const visibleSkills = skills.filter((skill) =>
    !normalizedCapabilityQuery ||
    `${skill.name} ${skill.description} ${skill.id}`.toLowerCase().includes(normalizedCapabilityQuery),
  );
  const installedPluginById = new Map(plugins.map((plugin) => [plugin.id, plugin]));
  const selectedInstalledPlugin = selectedPluginId
    ? installedPluginById.get(selectedPluginId)
    : undefined;
  const localPlugins = installedPluginsOutsideCatalog(plugins, pluginMarketplace);
  const selectedMarketplacePlugin = selectedInstalledPlugin && selectedInstalledPlugin.installationSource !== 'marketplace'
    ? undefined
    : selectedPluginId
      ? pluginMarketplace.find((plugin) => plugin.id === selectedPluginId)
      : undefined;
  const legacyHooksPlugin: RuntimePluginSummary | undefined = standaloneHooks.length ? {
    id: 'setsuna-legacy-hooks',
    name: t('capabilities.legacyHooks.name'),
    description: t('capabilities.legacyHooks.description'),
    installedAt: '',
    installationSource: 'local',
    skills: [],
    mcpServers: [],
    hooks: [],
    hookCount: standaloneHooks.length,
    resources: [],
  } : undefined;
  const visibleMarketplacePlugins = pluginMarketplace.filter((plugin) =>
    pluginMatchesQuery(plugin, normalizedCapabilityQuery, installedPluginById.get(plugin.id)));
  const visibleLocalPlugins = localPlugins.filter((plugin) =>
    pluginMatchesQuery(plugin, normalizedCapabilityQuery));
  const visibleLegacyHooksPlugin = legacyHooksPlugin
    && pluginMatchesQuery(legacyHooksPlugin, normalizedCapabilityQuery)
    ? legacyHooksPlugin
    : undefined;
  const hasVisiblePlugins = Boolean(
    visibleMarketplacePlugins.length || visibleLocalPlugins.length || visibleLegacyHooksPlugin,
  );
  const selectedPluginItemSource = selectedInstalledPlugin ? 'installed' : 'marketplace';
  const createCapabilityKind: keyof typeof chatCreateSkillIds = capabilityFilter === 'plugins'
    ? 'plugins'
    : capabilityFilter === 'skills' ? 'skills' : 'mcp';
  const getSelectedPluginItemContent = useCallback((kind: RuntimePluginItemKind, itemId: string) => {
    if (!selectedPluginId) return Promise.reject(new Error('Plugin detail is no longer selected.'));
    return onGetPluginItemContent(selectedPluginId, kind, itemId, selectedPluginItemSource);
  }, [onGetPluginItemContent, selectedPluginId, selectedPluginItemSource]);

  function resetMcpDraft() {
    setEditingMcpServer(null);
    setDraft(emptyMcpDraft);
    setMcpEditorOpen(false);
  }

  function openConversationCreate(kind: keyof typeof chatCreateSkillIds) {
    setCreateMenuOpen(false);
    setCapabilityFilter(kind);
    onCreateInConversation(chatCreateSkillIds[kind]);
  }

  function openMcpFormCreate() {
    setCreateMenuOpen(false);
    setCapabilityFilter('mcp');
    setSelectedMcpServerKey(null);
    setEditingMcpServer(null);
    resetMcpDraft();
    setMcpEditorOpen(true);
  }

  function openSkillFormCreate() {
    setCreateMenuOpen(false);
    setCapabilityFilter('skills');
    skillDetails.openCreate();
  }

  function editMcpServer(server: RuntimeMcpServer) {
    setSelectedMcpServerKey(server.key);
    setEditingMcpServer(server);
    setCapabilityFilter('mcp');
    setMcpEditorOpen(true);
    setDraft({
      key: server.key,
      label: server.label,
      description: server.description ?? '',
      transport: server.transport,
      command: server.command ?? '',
      args: server.args.length ? JSON.stringify(server.args, null, 2) : '',
      cwd: server.cwd ?? '',
      url: server.url ?? '',
      env: '',
      headers: '',
      envHttpHeaders: '',
      bearerTokenEnvVar: '',
      oauthClientId: server.oauthClientId ?? '',
      oauthResource: server.oauthResource ?? '',
      enabled: server.enabled,
      timeoutMs: server.timeoutMs ? String(server.timeoutMs) : '',
      startupTimeoutMs: server.startupTimeoutMs ? String(server.startupTimeoutMs) : '',
      toolTimeoutMs: server.toolTimeoutMs ? String(server.toolTimeoutMs) : '',
      allowedTools: server.allowedTools.join('\n'),
      disabledTools: server.disabledTools.join('\n'),
      tools: server.tools,
    });
  }

  async function submitMcpServer() {
    const key = draft.key.trim();
    if (!key) return;
    setSaving(true);
    try {
      await onSaveMcpServer(mcpDraftToInput(draft, key, editingMcpServer, t));
      resetMcpDraft();
    } finally {
      setSaving(false);
    }
  }

  async function removePlugin(plugin: RuntimePluginSummary) {
    const confirmed = window.confirm(t('capabilities.page.confirmRemovePlugin', { name: plugin.name }));
    if (!confirmed) return;
    setRemovingPluginIds((items) => new Set(items).add(plugin.id));
    setPluginError(null);
    try {
      await onRemovePlugin(plugin.id);
    } catch (unknownError) {
      setPluginError(pluginActionError(unknownError, t('capabilities.plugin.error.remove'), t));
    } finally {
      setRemovingPluginIds((items) => {
        const next = new Set(items);
        next.delete(plugin.id);
        return next;
      });
    }
  }

  async function setPluginExtensionTrust(plugin: RuntimePluginSummary, trusted: boolean) {
    if (trusted && !window.confirm(t('capabilities.extension.confirmTrust', { name: plugin.name }))) return;
    setTrustingExtensionIds((items) => new Set(items).add(plugin.id));
    setPluginError(null);
    try {
      await onSetPluginExtensionTrust(plugin.id, trusted);
    } catch (unknownError) {
      setPluginError(pluginActionError(unknownError, t('capabilities.plugin.error.update'), t));
    } finally {
      setTrustingExtensionIds((items) => {
        const next = new Set(items);
        next.delete(plugin.id);
        return next;
      });
    }
  }

  async function installOrUpdateMarketplacePlugin(plugin: RuntimePluginMarketplaceItem) {
    const updating = Boolean(plugin.installed && plugin.updateAvailable);
    if ((plugin.installed && !updating) || installingPluginIds.has(plugin.id)) return;
    setInstallingPluginIds((items) => new Set(items).add(plugin.id));
    setPluginError(null);
    try {
      if (updating) await onUpdateMarketplacePlugin(plugin.id);
      else await onInstallMarketplacePlugin(plugin.id);
    } catch (unknownError) {
      setPluginError(pluginActionError(
        unknownError,
        t(updating ? 'capabilities.plugin.error.update' : 'capabilities.plugin.error.install'),
        t,
      ));
    } finally {
      setInstallingPluginIds((items) => {
        const next = new Set(items);
        next.delete(plugin.id);
        return next;
      });
    }
  }

  async function installLocalPlugin() {
    if (installingLocalPlugin) return;
    setInstallingLocalPlugin(true);
    setPluginError(null);
    try {
      const result = await onInstallLocalPlugin();
      if (result) openPluginDetail(result.plugin);
    } catch (unknownError) {
      setPluginError(pluginActionError(unknownError, t('capabilities.plugin.error.install'), t));
    } finally {
      setInstallingLocalPlugin(false);
    }
  }

  function openPluginDetail(plugin: Pick<RuntimePluginSummary, 'id'>) {
    setCapabilityFilter('plugins');
    setLegacyHooksOpen(false);
    onSelectedPluginIdChange(plugin.id);
    setPluginError(null);
  }

  function selectCapabilityFilter(nextFilter: CapabilityFilter) {
    setCapabilityFilter(nextFilter);
    setSelectedMcpServerKey(null);
    setCapabilityQuery('');
    setCreateMenuOpen(false);
    setLegacyHooksOpen(false);
  }

  if (mcpEditorOpen) {
    return (
      <main className="capabilities-page desktop-capabilities-panel">
        <section className="desktop-capabilities-panel__inner desktop-capabilities-panel__inner--detail">
          <CapabilitiesMcpEditor
            draft={draft}
            editingMcpServer={editingMcpServer}
            saving={saving}
            setDraft={setDraft}
            onBack={resetMcpDraft}
            onFetchTools={onFetchMcpTools}
            onSave={submitMcpServer}
          />
        </section>
      </main>
    );
  }

  if (selectedMcpServer) {
    return (
      <main className="capabilities-page desktop-capabilities-panel">
        <section className="desktop-capabilities-panel__inner desktop-capabilities-panel__inner--detail">
          <CapabilitiesMcpDetail
            authPending={mcpAuthPendingKeys.has(selectedMcpServer.key)}
            server={selectedMcpServer}
            onBack={() => setSelectedMcpServerKey(null)}
            onDelete={() => {
              const confirmed = window.confirm(t('capabilities.page.confirmDeleteMcp', { name: selectedMcpServer.label }));
              if (!confirmed) return;
              void onDeleteMcpServer(selectedMcpServer).then(() => setSelectedMcpServerKey(null));
            }}
            onEdit={() => editMcpServer(selectedMcpServer)}
            onLogin={() => void updateMcpAuth(selectedMcpServer, () => onLoginMcpServer(selectedMcpServer))}
            onLogout={() => void updateMcpAuth(selectedMcpServer, () => onLogoutMcpServer(selectedMcpServer))}
            onUpdate={(patch) => void onUpdateMcpServer(selectedMcpServer, patch)}
          />
        </section>
      </main>
    );
  }

  if (skillPageMode === 'create' || skillPageMode === 'edit') {
    return (
      <main className="capabilities-page desktop-capabilities-panel">
        <section className="desktop-capabilities-panel__inner desktop-capabilities-panel__inner--detail">
          <CapabilitiesSkillEditor
            mode={skillPageMode}
            saving={skillSaving}
            skill={skillDetail}
            onBack={skillDetails.backFromEditor}
            onSave={skillDetails.save}
          />
        </section>
      </main>
    );
  }

  if (skillPageMode === 'view' && skillDetailSummary) {
    return (
      <main className="capabilities-page desktop-capabilities-panel">
        <section className="desktop-capabilities-panel__inner desktop-capabilities-panel__inner--detail">
          <CapabilitiesSkillDetail
            detail={skillDetail}
            error={skillDetailError}
            loading={skillDetailLoading}
            summary={skillDetailSummary}
            onBack={skillDetails.close}
            onDelete={skillDetails.remove}
            onEdit={skillDetails.openEditor}
            onUseInConversation={onCreateInConversation}
            onUpdateSkill={skillDetails.updateFromDetail}
            onInstallMcpDependencies={(skill) => skillDetails.updateDependency(
              skill,
              `install:${skill.id}`,
              () => onInstallSkillMcpDependencies(skill),
            )}
            onAuthenticateMcpDependency={(skill, serverKey) => skillDetails.updateDependency(
              skill,
              `auth:${skill.id}:${serverKey}`,
              () => onAuthenticateSkillMcpDependency(skill, serverKey),
            )}
            pendingDependencyKeys={skillDependencyPendingKeys}
          />
        </section>
      </main>
    );
  }

  if (legacyHooksOpen) {
    return (
      <main className="capabilities-page desktop-capabilities-panel">
        <section className="desktop-capabilities-panel__inner desktop-capabilities-panel__inner--detail">
          <CapabilitiesLegacyHooksDetail
            hooks={standaloneHooks}
            onBack={() => setLegacyHooksOpen(false)}
            onDelete={onDeleteStandaloneHook}
            onSetEnabled={onSetHookEnabled}
            onSetTrust={onSetHookTrust}
          />
        </section>
      </main>
    );
  }

  if (selectedPluginId && (selectedMarketplacePlugin || selectedInstalledPlugin)) {
    return (
      <main className="capabilities-page desktop-capabilities-panel">
        <section className="desktop-capabilities-panel__inner desktop-capabilities-panel__inner--detail">
          <CapabilitiesPluginDetail
            error={pluginError}
            imageGenerationConfig={config?.imageGeneration}
            runtimeConfig={config ?? undefined}
            installedPlugin={selectedInstalledPlugin}
            installing={installingPluginIds.has(selectedPluginId)}
            marketplacePlugin={selectedMarketplacePlugin}
            runtimeMcpServers={servers}
            runtimeSkills={skills}
            extensionStatus={extensionStatuses.find((status) => status.pluginId === selectedPluginId)}
            extensionTrusting={trustingExtensionIds.has(selectedPluginId)}
            removing={removingPluginIds.has(selectedPluginId)}
            runtimeHooks={hooks}
            onBack={() => {
              onSelectedPluginIdChange(null);
              setPluginError(null);
            }}
            onInstall={installOrUpdateMarketplacePlugin}
            onGetItemContent={getSelectedPluginItemContent}
            onGetSkillDetail={onGetSkillDetail}
            onRemove={removePlugin}
            onUseInConversation={onCreateInConversation}
            onSetExtensionTrust={selectedInstalledPlugin?.installationSource === 'marketplace'
              ? undefined
              : setPluginExtensionTrust}
            onSetHookEnabled={onSetHookEnabled}
            onSetHookTrust={onSetHookTrust}
            onSetSkillEnabled={async (skill, enabled) => {
              await onUpdateSkill(skill, { enabled });
            }}
            onSaveImageGenerationConfig={onSaveImageGenerationConfig}
            onTestImageGeneration={onTestImageGeneration}
            onSaveVisionRecognitionConfig={onSaveVisionRecognitionConfig}
            onTestVisionRecognition={onTestVisionRecognition}
          />
        </section>
      </main>
    );
  }

  const createConversationTitle = t(createCapabilityKind === 'mcp' ? 'capabilities.create.chatMcp' : 'capabilities.create.chatSkill');
  const createConversationDescription = createCapabilityKind === 'mcp'
    ? t('capabilities.create.chatMcpDescription')
    : t('capabilities.create.chatSkillDescription');
  const createFormTitle = t(createCapabilityKind === 'mcp' ? 'capabilities.create.formMcp' : 'capabilities.create.formSkill');
  const createFormDescription = createCapabilityKind === 'mcp'
    ? t('capabilities.create.formMcpDescription')
    : t('capabilities.create.formSkillDescription');
  const createFormIcon = createCapabilityKind === 'mcp' ? <Plug size={14} /> : <FilePlus2 size={14} />;
  const openFormCreate = createCapabilityKind === 'mcp' ? openMcpFormCreate : openSkillFormCreate;
  const marketplaceNoticeVisible = capabilityFilter === 'plugins' && Boolean(pluginError || pluginMarketplaceErrors.length);
  const capabilitySummary = capabilityFilter === 'plugins'
    ? t('capabilities.market.count', {
        plugins: pluginMarketplace.length,
        installed: plugins.length + Number(Boolean(legacyHooksPlugin)),
      })
    : t('capabilities.summary', {
      mcp: servers.length,
      enabledSkills: enabledSkillCount,
      skills: skills.length,
    });
  const capabilitySearchLabel = t(capabilityFilter === 'plugins'
    ? 'capabilities.search.plugins'
    : capabilityFilter === 'skills'
      ? 'capabilities.search.skills'
      : 'capabilities.search.mcp');

  async function updateMcpAuth(server: RuntimeMcpServer, action: () => Promise<void>) {
    setMcpAuthPendingKeys((items) => new Set([...items, server.key]));
    try {
      await action();
    } finally {
      setMcpAuthPendingKeys((items) => {
        const next = new Set(items);
        next.delete(server.key);
        return next;
      });
    }
  }

  const tabsInPage = shouldRenderCapabilitiesTabsInPage(getDesktopPlatform());
  const capabilityTabs = (
    <CapabilitiesTabs
      activeFilter={capabilityFilter}
      summary={capabilitySummary}
      t={t}
      onChange={selectCapabilityFilter}
    />
  );

  return (
    <>
      {tabsInPage ? null : <AppRouteTopbarPortal>{capabilityTabs}</AppRouteTopbarPortal>}
      <main className="capabilities-page desktop-capabilities-panel">
        <section className={`desktop-capabilities-panel__inner desktop-capabilities-panel__inner--catalog${capabilityFilter === 'plugins' ? ' desktop-capabilities-panel__inner--market' : ''}${capabilityFilter === 'skills' ? ' desktop-capabilities-panel__inner--skills' : ''}${marketplaceNoticeVisible ? ' desktop-capabilities-panel__inner--market-notice' : ''}${tabsInPage ? ' desktop-capabilities-panel__inner--page-tabs' : ''}`}>
          {tabsInPage ? capabilityTabs : null}
          <header className={`desktop-capabilities-header${capabilityFilter === 'plugins' ? ' desktop-capabilities-header--market' : ''}`}>
            <div className="desktop-capabilities-title">
              <h2>{capabilityCatalogTitle(capabilityFilter, t)}</h2>
            </div>
            <div className="desktop-capabilities-actions">
              <IconButton label={t('capabilities.refresh')} onClick={() => void onRefresh()}>
                <RefreshCw size={15} />
              </IconButton>
              {capabilityFilter === 'plugins' ? (
                <CapabilitiesPluginCreateMenu
                  importing={installingLocalPlugin}
                  open={createMenuOpen}
                  onCreateInConversation={() => openConversationCreate('plugins')}
                  onImport={() => void installLocalPlugin()}
                  onOpenChange={setCreateMenuOpen}
                />
              ) : (
                <CapabilitiesCreateMenu
                  buttonLabel={t('capabilities.create.action')}
                  items={[
                    {
                      id: `chat-${createCapabilityKind}`,
                      title: createConversationTitle,
                      description: createConversationDescription,
                      icon: <MessageSquare size={14} />,
                      onSelect: () => openConversationCreate(createCapabilityKind),
                    },
                    {
                      id: `form-${createCapabilityKind}`,
                      title: createFormTitle,
                      description: createFormDescription,
                      icon: createFormIcon,
                      onSelect: openFormCreate,
                    },
                  ]}
                  open={createMenuOpen}
                  onOpenChange={setCreateMenuOpen}
                />
              )}
            </div>
          </header>

          <div className="desktop-capabilities-search-row">
            <div className="desktop-capabilities-search">
              <Search size={14} />
              <input
                value={capabilityQuery}
                aria-label={capabilitySearchLabel}
                onChange={(event) => setCapabilityQuery(event.target.value)}
                placeholder={capabilitySearchLabel}
              />
            </div>
          </div>

          {marketplaceNoticeVisible ? (
            <div className="desktop-capabilities-market-notices">
              {pluginError ? <div className="desktop-capabilities-errors" role="alert">{pluginError}</div> : null}
              {pluginMarketplaceErrors.length ? (
                <div
                  className="desktop-capabilities-market-warning"
                  role="status"
                  title={pluginMarketplaceErrors.join('\n')}
                >
                  <AlertTriangle aria-hidden="true" size={14} />
                  <span>{t('capabilities.market.partialUnavailable')}</span>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="desktop-capabilities-grid">
            <div className={`desktop-capabilities-grid__content${capabilityFilter === 'mcp' ? ' desktop-capability-list' : ''}`}>
              {capabilityFilter === 'mcp'
                ? visibleServers.map((server) => (
                  <CapabilitiesMcpListItem
                    key={`mcp:${server.key}`}
                    server={server}
                    onOpen={() => setSelectedMcpServerKey(server.key)}
                    onUpdate={(patch) => void onUpdateMcpServer(server, patch)}
                  />
                ))
                : null}
              {capabilityFilter === 'skills'
                ? (
                  <CapabilitiesSkillCatalog
                    skills={visibleSkills}
                    onOpen={(skill) => void skillDetails.open(skill, 'view')}
                    onUpdate={(skill, patch) => void onUpdateSkill(skill, patch)}
                  />
                )
                : null}
              {capabilityFilter === 'plugins' && hasVisiblePlugins ? (
                <CapabilitiesPluginMarket
                  marketplacePlugins={visibleMarketplacePlugins}
                  localPlugins={visibleLocalPlugins}
                  legacyHooksPlugin={visibleLegacyHooksPlugin}
                  installingPluginIds={installingPluginIds}
                  onInstall={installOrUpdateMarketplacePlugin}
                  onOpenLegacyHooks={() => {
                    onSelectedPluginIdChange(null);
                    setLegacyHooksOpen(true);
                  }}
                  onOpenMarketplace={openPluginDetail}
                  onOpenLocal={openPluginDetail}
                />
              ) : null}
              {((capabilityFilter === 'mcp' && visibleServers.length)
                || (capabilityFilter === 'skills' && visibleSkills.length)
                || (capabilityFilter === 'plugins' && hasVisiblePlugins)) ? null : (
                <div className="desktop-capabilities-empty">
                  {capabilityFilter === 'plugins' && !normalizedCapabilityQuery
                    ? t('capabilities.market.empty')
                    : t('capabilities.empty')}
                </div>
              )}
            </div>
          </div>

          {capabilityFilter === 'mcp' && mcpState?.errors.length ? (
            <div className="desktop-capabilities-errors">
              {mcpState.errors.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          ) : null}
        </section>
      </main>
    </>
  );
}

export function shouldRenderCapabilitiesTabsInPage(platform: string): boolean {
  return platform === 'win32';
}

function CapabilitiesTabs({
  activeFilter,
  onChange,
  summary,
  t,
}: {
  activeFilter: CapabilityFilter;
  onChange: (filter: CapabilityFilter) => void;
  summary: string;
  t: Translate;
}) {
  const labels: Record<CapabilityFilter, string> = {
    plugins: t('capabilities.tab.plugins'),
    mcp: 'MCP',
    skills: t('capabilities.tab.skills'),
  };

  return (
    <nav className="desktop-capabilities-tabs" aria-label={t('capabilities.title.capabilities')}>
      {capabilityTabIds.map((tabId) => (
        <button
          className={activeFilter === tabId ? 'is-active' : ''}
          key={tabId}
          type="button"
          onClick={() => onChange(tabId)}
        >
          {labels[tabId]}
        </button>
      ))}
      <span>{summary}</span>
    </nav>
  );
}

export function pluginActionError(error: unknown, fallback: string, t: Translate = defaultTranslate): string {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[plugins] action failed', error);
  if (/already installed/iu.test(message)) return t('capabilities.plugin.error.installed');
  if (/conflict/iu.test(message)) return t('capabilities.plugin.error.conflict');
  if (/not found/iu.test(message)) return t('capabilities.plugin.error.notFound');
  const detail = message.replace(/\s+\((?:DELETE|GET|PATCH|POST|PUT)\s+\/[^)]+\)$/u, '').trim();
  if (!detail || detail === '[object Object]') return fallback;
  const conciseFallback = fallback.replace(/[，,.]?\s*(?:请重试|Try again)[。.]*$/iu, '');
  return t('capabilities.plugin.error.withDetail', { fallback: conciseFallback, detail });
}
