import type {
  RuntimeConfigState,
  RuntimeHookInput,
  RuntimeHookListResponse,
  RuntimeHookMetadata,
  RuntimeImageGenerationConfigInput,
  RuntimeImageGenerationTestInput,
  RuntimeImageGenerationTestResult,
  RuntimeMcpServer,
  RuntimeMcpServerInput,
  RuntimeMcpServerList,
  RuntimeMcpToolInfo,
  RuntimePluginItemContent,
  RuntimePluginItemKind,
  RuntimePluginMarketplaceItem,
  RuntimePluginSummary,
  RuntimeSkillDetail,
  RuntimeSkillInput,
  RuntimeSkillSummary,
} from '@setsuna-desktop/contracts';
import {
  FilePlus2,
  Info,
  MessageSquare,
  Plug,
  Plus,
  Puzzle,
  RefreshCw,
  Search,
} from 'lucide-react';
import { useCallback, useState } from 'react';
import { translate, useI18n, type Translate } from '../../shared/i18n/I18nProvider.js';
import { Button, IconButton } from '../../shared/ui/primitives.js';
import {
  CapabilitiesHookCard,
  CapabilitiesMcpCard,
  CapabilitiesSkillCard,
} from './CapabilitiesCatalogCards.js';
import {
  CapabilitiesHookEditor,
  emptyHookDraft,
  hookConfigEventName,
  hookDraftFromMetadata,
  hookDraftToInput,
  type HookDraft,
} from './CapabilitiesHookEditor.js';
import { CapabilitiesPluginDetail } from './CapabilitiesPluginDetail.js';
import { CapabilitiesPluginMarket } from './CapabilitiesPluginMarket.js';
import { CapabilitiesSkillDetail } from './CapabilitiesSkillDetail.js';
import { CapabilitiesSkillEditor } from './CapabilitiesSkillEditor.js';
import { CapabilitiesMcpEditor } from './mcp/CapabilitiesMcpEditor.js';
import {
  emptyMcpDraft,
  mcpDraftToInput,
  type McpDraft,
} from './mcp/mcp-editor-model.js';
import { pluginMatchesQuery } from './pluginDisplay.js';
import { localizedPluginSearchAliases } from './pluginLocalization.js';
import { useCapabilitySkillDetails } from './useCapabilitySkillDetails.js';

const defaultTranslate: Translate = (key, params) => translate('zh-CN', key, params);

const chatCreateSkillIds = {
  mcp: 'create-mcp-in-chat',
  skills: 'create-skill-in-chat',
} as const;

export function CapabilitiesPage({
  config,
  skills,
  selectedSkillCount,
  mcpState,
  hookState,
  plugins,
  pluginMarketplace,
  pluginMarketplaceErrors,
  selectedPluginId,
  onCreateHook,
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
  onRefreshHooks,
  onSaveMcpServer,
  onTrustHook,
  onUpdateHook,
  onUpdateHookEnabled,
  onDeleteHook,
  onUpdateMcpServer,
  onDeleteMcpServer,
  onLoginMcpServer,
  onLogoutMcpServer,
  onInstallMarketplacePlugin,
  onUpdateMarketplacePlugin,
  onRemovePlugin,
  onSelectedPluginIdChange,
  onSaveImageGenerationConfig,
  onTestImageGeneration,
}: {
  config: RuntimeConfigState | null;
  skills: RuntimeSkillSummary[];
  selectedSkillCount: number;
  mcpState: RuntimeMcpServerList | null;
  hookState: RuntimeHookListResponse | null;
  plugins: RuntimePluginSummary[];
  pluginMarketplace: RuntimePluginMarketplaceItem[];
  pluginMarketplaceErrors: string[];
  selectedPluginId: string | null;
  onCreateHook: (input: RuntimeHookInput) => Promise<void>;
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
  onRefreshHooks: () => Promise<RuntimeHookListResponse>;
  onSaveMcpServer: (input: RuntimeMcpServerInput) => Promise<void>;
  onTrustHook: (hook: RuntimeHookMetadata) => Promise<void>;
  onUpdateHook: (hook: RuntimeHookMetadata, input: RuntimeHookInput) => Promise<void>;
  onUpdateHookEnabled: (hook: RuntimeHookMetadata, enabled: boolean) => Promise<void>;
  onDeleteHook: (hook: RuntimeHookMetadata) => Promise<void>;
  onUpdateMcpServer: (server: RuntimeMcpServer, patch: Partial<Pick<RuntimeMcpServer, 'enabled' | 'required' | 'requireApproval'>>) => Promise<void>;
  onDeleteMcpServer: (server: RuntimeMcpServer) => void;
  onLoginMcpServer: (server: RuntimeMcpServer) => Promise<void>;
  onLogoutMcpServer: (server: RuntimeMcpServer) => Promise<void>;
  onInstallMarketplacePlugin: (pluginId: string) => Promise<unknown>;
  onUpdateMarketplacePlugin: (pluginId: string) => Promise<unknown>;
  onRemovePlugin: (pluginId: string) => Promise<void>;
  onSelectedPluginIdChange: (pluginId: string | null) => void;
  onSaveImageGenerationConfig: (input: RuntimeImageGenerationConfigInput) => Promise<void>;
  onTestImageGeneration: (input: RuntimeImageGenerationTestInput) => Promise<RuntimeImageGenerationTestResult>;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<McpDraft>(emptyMcpDraft);
  const [hookDraft, setHookDraft] = useState<HookDraft>(emptyHookDraft);
  const [saving, setSaving] = useState(false);
  const [hookSaving, setHookSaving] = useState(false);
  const [capabilityFilter, setCapabilityFilter] = useState<'mcp' | 'skills' | 'hooks' | 'plugins'>('plugins');
  const [capabilityQuery, setCapabilityQuery] = useState('');
  const [updatingHookKeys, setUpdatingHookKeys] = useState<Set<string>>(new Set());
  const [mcpAuthPendingKeys, setMcpAuthPendingKeys] = useState<Set<string>>(new Set());
  const [mcpEditorOpen, setMcpEditorOpen] = useState(false);
  const [hookEditorOpen, setHookEditorOpen] = useState(false);
  const [installingPluginIds, setInstallingPluginIds] = useState<Set<string>>(new Set());
  const [removingPluginIds, setRemovingPluginIds] = useState<Set<string>>(new Set());
  const [pluginError, setPluginError] = useState<string | null>(null);
  const [editingHook, setEditingHook] = useState<RuntimeHookMetadata | null>(null);
  const [editingMcpServer, setEditingMcpServer] = useState<RuntimeMcpServer | null>(null);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
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
  const hookEntries = hookState?.data ?? [];
  const hooks = hookEntries.flatMap((entry) => entry.hooks.map((hook) => ({ ...hook, cwd: entry.cwd })));
  const hookWarnings = hookEntries.flatMap((entry) => entry.warnings);
  const hookErrors = hookEntries.flatMap((entry) => entry.errors.map((error) => error.message));
  const enabledSkillCount = skills.filter((skill) => skill.enabled).length;
  const executableHookCount = hooks.filter((hook) => hook.enabled && (hook.trustStatus === 'trusted' || hook.trustStatus === 'managed')).length;
  const normalizedCapabilityQuery = capabilityQuery.trim().toLowerCase();
  const visibleServers = servers.filter((server) =>
    !normalizedCapabilityQuery ||
    `${server.label} ${server.key} ${server.transport}`.toLowerCase().includes(normalizedCapabilityQuery),
  );
  const visibleSkills = skills.filter((skill) =>
    !normalizedCapabilityQuery ||
    `${skill.name} ${skill.description} ${skill.id}`.toLowerCase().includes(normalizedCapabilityQuery),
  );
  const visibleHooks = hooks.filter((hook) =>
    !normalizedCapabilityQuery ||
    `${hook.key} ${hook.eventName} ${hook.matcher ?? ''} ${hook.command ?? ''} ${hook.sourcePath}`.toLowerCase().includes(normalizedCapabilityQuery),
  );
  const visiblePlugins = plugins.filter((plugin) => pluginMatchesQuery(
    plugin,
    normalizedCapabilityQuery,
    localizedPluginSearchAliases(plugin, t),
  ));
  const visibleMarketplacePlugins = pluginMarketplace.filter((plugin) => pluginMatchesQuery(
    plugin,
    normalizedCapabilityQuery,
    localizedPluginSearchAliases(plugin, t),
  ));
  const marketplacePluginIds = new Set(pluginMarketplace.map((plugin) => plugin.id));
  const visibleLocalPlugins = visiblePlugins.filter((plugin) => !marketplacePluginIds.has(plugin.id));
  const selectedMarketplacePlugin = selectedPluginId
    ? pluginMarketplace.find((plugin) => plugin.id === selectedPluginId)
    : undefined;
  const selectedInstalledPlugin = selectedPluginId
    ? plugins.find((plugin) => plugin.id === selectedPluginId)
    : undefined;
  const selectedPluginItemSource = selectedInstalledPlugin ? 'installed' : 'marketplace';
  const createCapabilityKind: 'mcp' | 'skills' = capabilityFilter === 'skills' ? 'skills' : 'mcp';
  const getSelectedPluginItemContent = useCallback((kind: RuntimePluginItemKind, itemId: string) => {
    if (!selectedPluginId) return Promise.reject(new Error('Plugin detail is no longer selected.'));
    return onGetPluginItemContent(selectedPluginId, kind, itemId, selectedPluginItemSource);
  }, [onGetPluginItemContent, selectedPluginId, selectedPluginItemSource]);

  function resetMcpDraft() {
    setEditingMcpServer(null);
    setDraft(emptyMcpDraft);
    setMcpEditorOpen(false);
  }

  function openConversationCreate(kind: 'mcp' | 'skills') {
    setCreateMenuOpen(false);
    setCapabilityFilter(kind);
    onCreateInConversation(chatCreateSkillIds[kind]);
  }

  function openMcpFormCreate() {
    setCreateMenuOpen(false);
    setCapabilityFilter('mcp');
    setEditingMcpServer(null);
    resetMcpDraft();
    setMcpEditorOpen(true);
  }

  function openSkillFormCreate() {
    setCreateMenuOpen(false);
    setCapabilityFilter('skills');
    skillDetails.openCreate();
  }

  function openHookFormCreate() {
    setCreateMenuOpen(false);
    setCapabilityFilter('hooks');
    setEditingHook(null);
    setHookDraft(emptyHookDraft);
    setHookEditorOpen(true);
  }

  function openHookEdit(hook: RuntimeHookMetadata) {
    setCapabilityFilter('hooks');
    setEditingHook(hook);
    setHookDraft(hookDraftFromMetadata(hook));
    setHookEditorOpen(true);
  }

  function editMcpServer(server: RuntimeMcpServer) {
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
      required: server.required,
      requireApproval: server.requireApproval,
      trustLevel: server.trustLevel,
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

  async function submitHook() {
    const command = hookDraft.command.trim();
    if (!command) return;
    setHookSaving(true);
    try {
      const input = hookDraftToInput(hookDraft);
      if (editingHook) await onUpdateHook(editingHook, input);
      else await onCreateHook(input);
      setHookDraft(emptyHookDraft);
      setEditingHook(null);
      setHookEditorOpen(false);
    } finally {
      setHookSaving(false);
    }
  }

  async function deleteHook(hook: RuntimeHookMetadata) {
    const confirmed = window.confirm(t('capabilities.page.confirmDeleteHook', { event: hookConfigEventName(hook) }));
    if (!confirmed) return;
    await updateHook(hook, () => onDeleteHook(hook));
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

  function openPluginDetail(plugin: Pick<RuntimePluginSummary, 'id'>) {
    setCapabilityFilter('plugins');
    onSelectedPluginIdChange(plugin.id);
    setPluginError(null);
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

  if (hookEditorOpen) {
    const closeHookEditor = () => {
      setEditingHook(null);
      setHookEditorOpen(false);
    };
    return (
      <main className="capabilities-page desktop-capabilities-panel">
        <section className="desktop-capabilities-panel__inner desktop-capabilities-panel__inner--detail">
          <CapabilitiesHookEditor
            draft={hookDraft}
            editingHook={editingHook}
            saving={hookSaving}
            setDraft={setHookDraft}
            onBack={closeHookEditor}
            onSave={() => void submitHook()}
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

  if (selectedPluginId && (selectedMarketplacePlugin || selectedInstalledPlugin)) {
    return (
      <main className="capabilities-page desktop-capabilities-panel">
        <section className="desktop-capabilities-panel__inner desktop-capabilities-panel__inner--detail">
          <CapabilitiesPluginDetail
            error={pluginError}
            imageGenerationConfig={config?.imageGeneration}
            installedPlugin={selectedInstalledPlugin}
            installing={installingPluginIds.has(selectedPluginId)}
            marketplacePlugin={selectedMarketplacePlugin}
            runtimeMcpServers={servers}
            removing={removingPluginIds.has(selectedPluginId)}
            runtimeHooks={hooks}
            onBack={() => {
              onSelectedPluginIdChange(null);
              setPluginError(null);
            }}
            onInstall={installOrUpdateMarketplacePlugin}
            onGetItemContent={getSelectedPluginItemContent}
            onRemove={removePlugin}
            onSaveImageGenerationConfig={onSaveImageGenerationConfig}
            onTestImageGeneration={onTestImageGeneration}
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

  async function updateHook(hook: RuntimeHookMetadata, action: () => Promise<void>) {
    setUpdatingHookKeys((items) => new Set([...items, hook.key]));
    try {
      await action();
    } finally {
      setUpdatingHookKeys((items) => {
        const next = new Set(items);
        next.delete(hook.key);
        return next;
      });
    }
  }

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

  return (
    <main className="capabilities-page desktop-capabilities-panel">
      <section className={`desktop-capabilities-panel__inner${capabilityFilter === 'plugins' ? ' desktop-capabilities-panel__inner--market' : ''}${marketplaceNoticeVisible ? ' desktop-capabilities-panel__inner--market-notice' : ''}`}>
        <header className="desktop-capabilities-header">
          <div className="desktop-capabilities-title">
            <h2>{t(capabilityFilter === 'plugins' ? 'capabilities.title.marketplace' : 'capabilities.title.capabilities')}</h2>
          </div>
          <div className="desktop-capabilities-actions">
            <div className="desktop-capabilities-search">
              <Search size={14} />
              <input
                value={capabilityQuery}
                onChange={(event) => setCapabilityQuery(event.target.value)}
                placeholder={t(capabilityFilter === 'plugins' ? 'capabilities.search.plugins' : 'capabilities.search.capabilities')}
              />
            </div>
            <IconButton label={t('capabilities.refresh')} onClick={() => void (capabilityFilter === 'hooks' ? onRefreshHooks() : onRefresh())}>
              <RefreshCw size={15} />
            </IconButton>
            {capabilityFilter === 'hooks' ? (
              <Button type="button" variant="primary" icon={<Plus size={14} />} onClick={openHookFormCreate}>
                {t('capabilities.create.action')}
              </Button>
            ) : capabilityFilter === 'plugins' ? null : (
            <div className="desktop-capabilities-create">
              <Button type="button" variant="primary" icon={<Plus size={14} />} onClick={() => setCreateMenuOpen((value) => !value)}>
                {t('capabilities.create.action')}
              </Button>
              {createMenuOpen ? (
                <div className="desktop-capabilities-create-menu">
                  <button className="desktop-capabilities-create-menu__item" type="button" onClick={() => openConversationCreate(createCapabilityKind)}>
                    <span className="desktop-capabilities-create-menu__icon"><MessageSquare size={14} /></span>
                    <span className="desktop-capabilities-create-menu__content">
                      <strong>{createConversationTitle}</strong>
                      <span>{createConversationDescription}</span>
                    </span>
                  </button>
                  <button className="desktop-capabilities-create-menu__item" type="button" onClick={openFormCreate}>
                    <span className="desktop-capabilities-create-menu__icon">{createFormIcon}</span>
                    <span className="desktop-capabilities-create-menu__content">
                      <strong>{createFormTitle}</strong>
                      <span>{createFormDescription}</span>
                    </span>
                  </button>
                </div>
              ) : null}
            </div>
            )}
          </div>
        </header>

        <div className="desktop-capabilities-tabs">
          <button className={capabilityFilter === 'plugins' ? 'is-active' : ''} type="button" onClick={() => setCapabilityFilter('plugins')}>
            {t('capabilities.tab.plugins')}
          </button>
          <button className={capabilityFilter === 'mcp' ? 'is-active' : ''} type="button" onClick={() => setCapabilityFilter('mcp')}>
            MCP
          </button>
          <button className={capabilityFilter === 'skills' ? 'is-active' : ''} type="button" onClick={() => setCapabilityFilter('skills')}>
            {t('capabilities.tab.skills')}
          </button>
          <button className={capabilityFilter === 'hooks' ? 'is-active' : ''} type="button" onClick={() => setCapabilityFilter('hooks')}>
            Hooks
          </button>
          <span>
            {capabilityFilter === 'plugins'
              ? t('capabilities.market.count', { plugins: pluginMarketplace.length, installed: plugins.length })
              : t('capabilities.summary', {
                  mcp: servers.length,
                  enabledSkills: enabledSkillCount,
                  skills: skills.length,
                  defaultSkills: selectedSkillCount,
                  executableHooks: executableHookCount,
                  hooks: hooks.length,
                })}
          </span>
        </div>

        {marketplaceNoticeVisible ? (
          <div className="desktop-capabilities-market-notices">
            {pluginError ? <div className="desktop-capabilities-errors" role="alert">{pluginError}</div> : null}
            {pluginMarketplaceErrors.length ? (
              <div
                className="desktop-capabilities-errors"
                role="status"
                title={pluginMarketplaceErrors.join('\n')}
              >
                {t('capabilities.market.partialUnavailable')}
              </div>
            ) : null}
          </div>
        ) : null}

        {capabilityFilter !== 'plugins' ? (
          <div className="desktop-capabilities-usage-note">
            <Info size={14} />
            <span>
              {t(capabilityFilter === 'mcp'
                ? 'capabilities.usage.mcp'
                : capabilityFilter === 'skills'
                  ? 'capabilities.usage.skills'
                  : 'capabilities.usage.hooks')}
            </span>
          </div>
        ) : null}

        <div className={`desktop-capabilities-grid${capabilityFilter === 'plugins' ? ' desktop-capabilities-grid--market' : ''}`}>
          {capabilityFilter === 'mcp'
            ? visibleServers.map((server) => (
              <CapabilitiesMcpCard
                key={`mcp:${server.key}`}
                authPending={mcpAuthPendingKeys.has(server.key)}
                server={server}
                onDelete={() => onDeleteMcpServer(server)}
                onEdit={() => editMcpServer(server)}
                onLogin={() => void updateMcpAuth(
                  server,
                  () => onLoginMcpServer(server),
                )}
                onLogout={() => void updateMcpAuth(
                  server,
                  () => onLogoutMcpServer(server),
                )}
                onUpdate={(patch) => void onUpdateMcpServer(server, patch)}
              />
            ))
            : null}
          {capabilityFilter === 'skills'
            ? visibleSkills.map((skill) => {
              const dependencies = skill.mcpDependencies ?? [];
              const authDependency = dependencies.find(
                (dependency) => dependency.status === 'authRequired'
                  || dependency.status === 'error',
              );
              const dependencyPending = skillDependencyPendingKeys.has(
                `install:${skill.id}`,
              ) || Boolean(
                authDependency
                && skillDependencyPendingKeys.has(
                  `auth:${skill.id}:${authDependency.value}`,
                ),
              );
              return (
                <CapabilitiesSkillCard
                  key={`skill:${skill.id}`}
                  dependencyPending={dependencyPending}
                  skill={skill}
                  onAuthenticateDependency={(serverKey) => void skillDetails.updateDependency(
                    skill,
                    `auth:${skill.id}:${serverKey}`,
                    () => onAuthenticateSkillMcpDependency(skill, serverKey),
                  )}
                  onEdit={() => void skillDetails.open(skill, 'edit')}
                  onInstallDependencies={() => void skillDetails.updateDependency(
                    skill,
                    `install:${skill.id}`,
                    () => onInstallSkillMcpDependencies(skill),
                  )}
                  onOpen={() => void skillDetails.open(skill, 'view')}
                  onUpdate={(patch) => void onUpdateSkill(skill, patch)}
                />
              );
            })
            : null}
          {capabilityFilter === 'hooks'
            ? visibleHooks.map((hook) => (
              <CapabilitiesHookCard
                key={`hook:${hook.key}`}
                hook={hook}
                updating={updatingHookKeys.has(hook.key)}
                onDelete={() => void deleteHook(hook)}
                onEdit={() => openHookEdit(hook)}
                onSetEnabled={(enabled) => void updateHook(
                  hook,
                  () => onUpdateHookEnabled(hook, enabled),
                )}
                onTrust={() => void updateHook(
                  hook,
                  () => onTrustHook(hook),
                )}
              />
            ))
            : null}
          {capabilityFilter === 'plugins' && (visibleMarketplacePlugins.length || visibleLocalPlugins.length) ? (
            <CapabilitiesPluginMarket
              marketplacePlugins={visibleMarketplacePlugins}
              localPlugins={visibleLocalPlugins}
              installingPluginIds={installingPluginIds}
              searching={Boolean(normalizedCapabilityQuery)}
              onInstall={installOrUpdateMarketplacePlugin}
              onOpenMarketplace={openPluginDetail}
              onOpenLocal={openPluginDetail}
            />
          ) : null}
          {((capabilityFilter === 'mcp' && visibleServers.length)
            || (capabilityFilter === 'skills' && visibleSkills.length)
            || (capabilityFilter === 'hooks' && visibleHooks.length)
            || (capabilityFilter === 'plugins' && (visibleMarketplacePlugins.length || visibleLocalPlugins.length))) ? null : (
            capabilityFilter === 'hooks' && !normalizedCapabilityQuery ? (
              <div className="desktop-capabilities-empty desktop-capabilities-empty--hooks">
                <Puzzle size={24} />
                <strong>{t('capabilities.hook.emptyTitle')}</strong>
                <span>{t('capabilities.hook.emptyDescription')}</span>
                <Button type="button" variant="secondary" onClick={() => setCapabilityFilter('plugins')}>{t('capabilities.hook.openMarketplace')}</Button>
              </div>
            ) : (
              <div className="desktop-capabilities-empty">
                {capabilityFilter === 'plugins'
                  ? normalizedCapabilityQuery ? t('capabilities.market.noMatch') : t('capabilities.market.empty')
                  : capabilityFilter === 'hooks' ? t('capabilities.hook.noMatch') : t('capabilities.empty')}
              </div>
            )
          )}
        </div>

        {capabilityFilter === 'hooks' && (hookWarnings.length || hookErrors.length) ? (
          <div className="desktop-capabilities-errors">
            {[...hookWarnings, ...hookErrors].map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
        ) : null}

        {capabilityFilter === 'mcp' && mcpState?.errors.length ? (
          <div className="desktop-capabilities-errors">
            {mcpState.errors.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
        ) : null}

      </section>
    </main>
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
