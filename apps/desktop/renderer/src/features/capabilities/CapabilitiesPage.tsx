import type {
  RuntimeConfigState,
  RuntimeHookEventName,
  RuntimeHookInput,
  RuntimeHookListResponse,
  RuntimeHookMetadata,
  RuntimeImageGenerationConfigInput,
  RuntimeImageGenerationTestInput,
  RuntimeImageGenerationTestResult,
  RuntimeMcpRequireApproval,
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
  BookOpen,
  FilePlus2,
  Info,
  Loader2,
  LogIn,
  LogOut,
  MessageSquare,
  Pencil,
  Plug,
  Plus,
  Puzzle,
  RefreshCw,
  Save,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import { translate, useI18n, type Translate } from '../../shared/i18n/I18nProvider.js';
import type { MessageKey } from '../../shared/i18n/messages.js';
import { Button, IconButton, PageHeader, SelectField, TextArea, TextField } from '../../shared/ui/primitives.js';
import { CapabilitiesPluginDetail } from './CapabilitiesPluginDetail.js';
import { CapabilitiesPluginMarket } from './CapabilitiesPluginMarket.js';
import { CapabilitiesSkillDetail } from './CapabilitiesSkillDetail.js';
import { CapabilitiesSkillEditor } from './CapabilitiesSkillEditor.js';
import { CapabilitiesMcpEditor, McpFormField } from './mcp/CapabilitiesMcpEditor.js';
import {
  emptyMcpDraft,
  mcpAuthStatusLabel,
  mcpDraftToInput,
  mcpToolStats,
  optionalNumber,
  type McpDraft,
} from './mcp/mcp-editor-model.js';
import { pluginMatchesQuery } from './pluginDisplay.js';
import { localizedPluginSearchAliases } from './pluginLocalization.js';

type HookDraft = {
  eventName: RuntimeHookEventName;
  matcher: string;
  command: string;
  commandWindows: string;
  timeoutSec: string;
  statusMessage: string;
};

const emptyHookDraft: HookDraft = {
  eventName: 'PreToolUse',
  matcher: '',
  command: '',
  commandWindows: '',
  timeoutSec: '600',
  statusMessage: '',
};

const hookEventOptions: Array<{ value: RuntimeHookEventName; labelKey: MessageKey; matcher: boolean }> = [
  { value: 'PreToolUse', labelKey: 'capabilities.hook.event.preToolUse', matcher: true },
  { value: 'PermissionRequest', labelKey: 'capabilities.hook.event.permissionRequest', matcher: true },
  { value: 'PostToolUse', labelKey: 'capabilities.hook.event.postToolUse', matcher: true },
  { value: 'PreCompact', labelKey: 'capabilities.hook.event.preCompact', matcher: true },
  { value: 'PostCompact', labelKey: 'capabilities.hook.event.postCompact', matcher: true },
  { value: 'SessionStart', labelKey: 'capabilities.hook.event.sessionStart', matcher: true },
  { value: 'UserPromptSubmit', labelKey: 'capabilities.hook.event.userPromptSubmit', matcher: false },
  { value: 'SubagentStart', labelKey: 'capabilities.hook.event.subagentStart', matcher: true },
  { value: 'SubagentStop', labelKey: 'capabilities.hook.event.subagentStop', matcher: true },
  { value: 'Stop', labelKey: 'capabilities.hook.event.stop', matcher: false },
];

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
  const [selectedPluginId, setSelectedPluginId] = useState<string | null>(null);
  const [installingPluginIds, setInstallingPluginIds] = useState<Set<string>>(new Set());
  const [removingPluginIds, setRemovingPluginIds] = useState<Set<string>>(new Set());
  const [pluginError, setPluginError] = useState<string | null>(null);
  const [editingHook, setEditingHook] = useState<RuntimeHookMetadata | null>(null);
  const [editingMcpServer, setEditingMcpServer] = useState<RuntimeMcpServer | null>(null);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [skillPageMode, setSkillPageMode] = useState<'view' | 'edit' | 'create' | null>(null);
  const [skillDetailSummary, setSkillDetailSummary] = useState<RuntimeSkillSummary | null>(null);
  const [skillDetail, setSkillDetail] = useState<RuntimeSkillDetail | null>(null);
  const [skillDetailLoading, setSkillDetailLoading] = useState(false);
  const [skillDetailError, setSkillDetailError] = useState<string | null>(null);
  const [skillSaving, setSkillSaving] = useState(false);
  const [skillDependencyPendingKeys, setSkillDependencyPendingKeys] = useState<Set<string>>(new Set());
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
    setSkillPageMode('create');
    setSkillDetailSummary(null);
    setSkillDetail(null);
    setSkillDetailError(null);
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
    setHookDraft({
      eventName: hookConfigEventName(hook),
      matcher: hook.matcher ?? '',
      command: hook.command ?? '',
      commandWindows: '',
      timeoutSec: String(hook.timeoutSec || 600),
      statusMessage: hook.statusMessage ?? '',
    });
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

  async function openSkillDetail(skill: RuntimeSkillSummary, mode: 'view' | 'edit' = 'view') {
    setCapabilityFilter('skills');
    setSkillPageMode(mode);
    setSkillDetailSummary(skill);
    setSkillDetail(null);
    setSkillDetailError(null);
    setSkillDetailLoading(true);
    try {
      const detail = await onGetSkillDetail(skill.id);
      setSkillDetail(detail);
      setSkillDetailSummary(detail);
    } catch (unknownError) {
      setSkillDetailError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setSkillDetailLoading(false);
    }
  }

  async function updateSkillFromDetail(skill: RuntimeSkillSummary, patch: Partial<Pick<RuntimeSkillSummary, 'enabled' | 'selected'>>) {
    const updated = await onUpdateSkill(skill, patch);
    setSkillDetailSummary(updated);
    setSkillDetail(updated);
  }

  function updateSkillEnabled(skill: RuntimeSkillSummary, enabled: boolean) {
    void onUpdateSkill(skill, {
      enabled,
      ...(enabled ? {} : { selected: false }),
    });
  }

  async function saveSkill(input: RuntimeSkillInput) {
    setSkillSaving(true);
    try {
      const saved =
        skillPageMode === 'create'
          ? await onCreateSkill(input)
          : skillDetailSummary
            ? await onUpdateSkill(skillDetailSummary, input)
            : null;
      if (!saved) return;
      setSkillDetailSummary(saved);
      setSkillDetail(saved);
      setSkillPageMode('view');
    } finally {
      setSkillSaving(false);
    }
  }

  async function deleteSkill(skill: RuntimeSkillSummary) {
    const confirmed = window.confirm(t('capabilities.page.confirmDeleteSkill', { name: skill.name }));
    if (!confirmed) return;
    await onDeleteSkill(skill);
    setSkillDetailSummary(null);
    setSkillDetail(null);
    setSkillPageMode(null);
  }

  async function updateSkillDependency(
    skill: RuntimeSkillSummary,
    key: string,
    action: () => Promise<RuntimeSkillDetail>,
  ) {
    setSkillDependencyPendingKeys((items) => new Set(items).add(key));
    try {
      const updated = await action();
      if (skillDetailSummary?.id === updated.id) {
        setSkillDetailSummary(updated);
        setSkillDetail(updated);
      }
    } finally {
      setSkillDependencyPendingKeys((items) => {
        const next = new Set(items);
        next.delete(key);
        return next;
      });
    }
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
    setSelectedPluginId(plugin.id);
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
    const selectedEvent = hookEventOptions.find((item) => item.value === hookDraft.eventName) ?? hookEventOptions[0];
    return (
      <main className="capabilities-page desktop-capabilities-panel">
        <section className="desktop-capabilities-panel__inner desktop-capabilities-panel__inner--detail">
          <div className="desktop-capabilities-detail desktop-capabilities-hook-editor">
            <PageHeader
              title={t(editingHook ? 'capabilities.hook.editor.edit' : 'capabilities.hook.editor.create')}
              subtitle={t(editingHook ? 'capabilities.hook.editor.editSubtitle' : 'capabilities.hook.editor.createSubtitle')}
              onBack={() => {
                setEditingHook(null);
                setHookEditorOpen(false);
              }}
              actions={
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setEditingHook(null);
                      setHookEditorOpen(false);
                    }}
                  >
                    {t('common.cancel')}
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    icon={hookSaving ? <Loader2 size={14} className="is-spinning" /> : <Save size={14} />}
                    disabled={hookSaving || !hookDraft.command.trim()}
                    onClick={() => void submitHook()}
                  >
                    {t(editingHook ? 'capabilities.hook.editor.saveChanges' : 'capabilities.hook.editor.save')}
                  </Button>
                </>
              }
            />
            <div className="desktop-capabilities-hook-form">
              <McpFormField className="desktop-capabilities-hook-form__full" label={t('capabilities.hook.editor.trigger')}>
                <SelectField
                  value={hookDraft.eventName}
                  onValueChange={(nextValue) => setHookDraftField(setHookDraft, 'eventName', nextValue as RuntimeHookEventName)}
                >
                  {hookEventOptions.map((item) => (
                    <option key={item.value} value={item.value}>{t(item.labelKey)}</option>
                  ))}
                </SelectField>
              </McpFormField>
              <McpFormField
                className="desktop-capabilities-hook-form__full"
                label="Matcher"
                help={t(selectedEvent.matcher ? 'capabilities.hook.editor.matcherHelp' : 'capabilities.hook.editor.matcherUnused')}
              >
                <TextField
                  value={hookDraft.matcher}
                  disabled={!selectedEvent.matcher}
                  placeholder={t(selectedEvent.matcher ? 'capabilities.hook.editor.matcherPlaceholder' : 'capabilities.hook.editor.notApplicable')}
                  onChange={(event) => setHookDraftField(setHookDraft, 'matcher', event.currentTarget.value)}
                />
              </McpFormField>
              <McpFormField className="desktop-capabilities-skill-form__full" label={t('capabilities.hook.editor.unixCommand')}>
                <TextArea
                  rows={3}
                  value={hookDraft.command}
                  placeholder={t('capabilities.hook.editor.unixPlaceholder')}
                  onChange={(event) => setHookDraftField(setHookDraft, 'command', event.currentTarget.value)}
                />
              </McpFormField>
              <McpFormField className="desktop-capabilities-skill-form__full" label={t('capabilities.hook.editor.windowsCommand')} help={t('capabilities.hook.editor.windowsHelp')}>
                <TextArea
                  rows={2}
                  value={hookDraft.commandWindows}
                  placeholder={t('capabilities.hook.editor.windowsPlaceholder')}
                  onChange={(event) => setHookDraftField(setHookDraft, 'commandWindows', event.currentTarget.value)}
                />
              </McpFormField>
              <McpFormField label={t('capabilities.hook.editor.timeout')}>
                <TextField
                  type="number"
                  min="1"
                  value={hookDraft.timeoutSec}
                  onChange={(event) => setHookDraftField(setHookDraft, 'timeoutSec', event.currentTarget.value)}
                />
              </McpFormField>
              <McpFormField label={t('capabilities.hook.editor.statusMessage')}>
                <TextField
                  value={hookDraft.statusMessage}
                  placeholder={t('capabilities.hook.editor.statusPlaceholder')}
                  onChange={(event) => setHookDraftField(setHookDraft, 'statusMessage', event.currentTarget.value)}
                />
              </McpFormField>
            </div>
          </div>
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
            onBack={() => {
              if (skillDetailSummary) {
                setSkillPageMode('view');
                return;
              }
              setSkillPageMode(null);
            }}
            onSave={saveSkill}
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
            onBack={() => {
              setSkillDetailSummary(null);
              setSkillDetail(null);
              setSkillDetailError(null);
              setSkillPageMode(null);
            }}
            onDelete={deleteSkill}
            onEdit={() => setSkillPageMode('edit')}
            onUpdateSkill={updateSkillFromDetail}
            onInstallMcpDependencies={(skill) => updateSkillDependency(
              skill,
              `install:${skill.id}`,
              () => onInstallSkillMcpDependencies(skill),
            )}
            onAuthenticateMcpDependency={(skill, serverKey) => updateSkillDependency(
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
              setSelectedPluginId(null);
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
            ? visibleServers.map((server) => {
                const endpoint = server.transport === 'stdio' ? [server.command, ...server.args].filter(Boolean).join(' ') : server.url;
                const toolStats = mcpToolStats(server.tools, server.allowedTools, server.disabledTools);
                const authPending = mcpAuthPendingKeys.has(server.key) || server.authStatus === 'oAuthLoggingIn';
                const canUseOAuth = server.transport === 'streamableHttp'
                  && server.authStatus !== 'bearerToken'
                  && Boolean(server.oauthClientId || server.oauthResource || server.authStatus === 'oAuth' || server.authStatus === 'oAuthExpired' || server.authStatus === 'oAuthError');
                return (
                  <article className="desktop-capability-card desktop-capability-card--mcp" key={`mcp:${server.key}`}>
                    <div className="desktop-capability-card__head desktop-capability-card__head--mcp">
                      <div className="desktop-capability-card__head-main desktop-capability-card__mcp-identity">
                        <span className="desktop-capability-card__icon"><Plug size={20} /></span>
                        <div className="desktop-capability-card__mcp-heading">
                          <h2>{server.label}</h2>
                          <p title={endpoint || undefined}>{endpoint || server.description || t('capabilities.mcp.noEndpoint')}</p>
                        </div>
                      </div>
                      <span className="desktop-capability-card__head-actions">
                        <IconButton label="Edit MCP server" variant="ghost" onClick={() => editMcpServer(server)}>
                          <Pencil size={14} />
                        </IconButton>
                        <IconButton label="Delete MCP server" variant="danger" disabled={server.readOnly} onClick={() => onDeleteMcpServer(server)}>
                          <Trash2 size={14} />
                        </IconButton>
                      </span>
                    </div>
                    <div className="desktop-capability-card__mcp-summary">
                      <div className="desktop-capability-card__meta">
                        <span>{server.key}</span>
                        <span>{server.transport}</span>
                      </div>
                      <div className="desktop-capability-card__tool-policy">
                        <span>{toolStats.total
                          ? t('capabilities.mcp.toolsEnabled', { enabled: toolStats.enabled, total: toolStats.total })
                          : t('capabilities.mcp.toolsNotFetched')}</span>
                        <span title={server.authError}>{mcpAuthStatusLabel(server.authStatus, t)}</span>
                      </div>
                    </div>
                    <div className="desktop-capability-card__actions desktop-capability-card__actions--mcp">
                      <div className="desktop-capability-card__mcp-setting">
                        <span className="desktop-capability-card__mcp-setting-label">{t('capabilities.mcp.serviceStatus')}</span>
                        <div className="desktop-capability-card__mcp-switches">
                          <label className="sd-check" title={t('capabilities.mcp.enableHint')}>
                            <input type="checkbox" checked={server.enabled} disabled={server.readOnly} onChange={(event) => void onUpdateMcpServer(server, { enabled: event.currentTarget.checked })} />
                            <span>{t('capabilities.mcp.enabled')}</span>
                          </label>
                          <label className="sd-check" title={t('capabilities.mcp.requiredHint')}>
                            <input type="checkbox" checked={server.required} disabled={server.readOnly} onChange={(event) => void onUpdateMcpServer(server, { required: event.currentTarget.checked })} />
                            <span>{t('capabilities.mcp.required')}</span>
                          </label>
                        </div>
                      </div>
                      <div className="desktop-capability-card__mcp-setting desktop-capability-card__mcp-approval">
                        <span className="desktop-capability-card__mcp-setting-label">{t('capabilities.mcp.callApproval')}</span>
                        <SelectField
                          aria-label={t('capabilities.mcp.callApproval')}
                          value={server.requireApproval}
                          disabled={server.readOnly}
                          onValueChange={(nextValue) => void onUpdateMcpServer(server, { requireApproval: nextValue as RuntimeMcpRequireApproval })}
                        >
                          <option value="auto">{t('capabilities.mcp.approval.auto')}</option>
                          <option value="prompt">{t('capabilities.mcp.approval.prompt')}</option>
                          <option value="approve">{t('capabilities.mcp.approval.approve')}</option>
                        </SelectField>
                      </div>
                      {canUseOAuth ? (
                        <div className="desktop-capability-card__mcp-setting">
                          <span className="desktop-capability-card__mcp-setting-label">OAuth</span>
                          {server.authStatus === 'oAuth' ? (
                            <Button type="button" variant="secondary" icon={<LogOut size={14} />} disabled={authPending} onClick={() => void updateMcpAuth(server, () => onLogoutMcpServer(server))}>
                              {authPending ? t('common.processing') : t('capabilities.mcp.logout')}
                            </Button>
                          ) : (
                            <Button type="button" variant="secondary" icon={authPending ? <Loader2 className="is-spinning" size={14} /> : <LogIn size={14} />} disabled={authPending} onClick={() => void updateMcpAuth(server, () => onLoginMcpServer(server))}>
                              {t(authPending ? 'capabilities.mcp.awaitingAuthorization' : 'capabilities.mcp.login')}
                            </Button>
                          )}
                        </div>
                      ) : null}
                    </div>
                  </article>
                );
              })
            : null}
          {capabilityFilter === 'skills'
            ? visibleSkills.map((skill) => {
                const selectedByDefault = skill.enabled && skill.selected;
                const dependencies = skill.mcpDependencies ?? [];
                const installableDependencies = dependencies.filter((dependency) => dependency.status === 'missing' || dependency.status === 'disabled' || dependency.status === 'unchecked');
                const authDependency = dependencies.find((dependency) => dependency.status === 'authRequired' || dependency.status === 'error');
                const dependencyPending = skillDependencyPendingKeys.has(`install:${skill.id}`)
                  || Boolean(authDependency && skillDependencyPendingKeys.has(`auth:${skill.id}:${authDependency.value}`));
                return (
                <article className="desktop-capability-card" key={`skill:${skill.id}`}>
                  <div className="desktop-capability-card__head">
                    <span className="desktop-capability-card__icon"><BookOpen size={14} /></span>
                    <span className={`desktop-capability-card__status ${selectedByDefault ? 'is-on' : ''}`}>
                      {t(selectedByDefault
                        ? 'capabilities.skill.list.default'
                        : skill.enabled
                          ? 'capabilities.skill.list.enabled'
                          : 'capabilities.skill.list.disabled')}
                    </span>
                  </div>
                  <h2>{skill.name}</h2>
                  <p>{skill.description || skill.id}</p>
                  <div className="desktop-capability-card__meta">
                    <span>{skill.id}</span>
                    {dependencies.length ? (
                      <span>{t('capabilities.skill.list.mcpReady', {
                        ready: dependencies.filter((dependency) => dependency.status === 'ready').length,
                        total: dependencies.length,
                      })}</span>
                    ) : null}
                    {skill.dependencyErrors?.length ? <span>{t('capabilities.skill.list.dependencyError')}</span> : null}
                  </div>
                  <div className="desktop-capability-card__actions">
                    <Button type="button" variant="ghost" icon={<BookOpen size={14} />} onClick={() => void openSkillDetail(skill, 'view')}>
                      {t('capabilities.skill.list.view')}
                    </Button>
                    {skill.kind === 'user' ? (
                      <IconButton label="Edit Skill" variant="ghost" onClick={() => void openSkillDetail(skill, 'edit')}>
                        <Pencil size={14} />
                      </IconButton>
                    ) : null}
                    {installableDependencies.length ? (
                      <Button
                        type="button"
                        variant="secondary"
                        icon={dependencyPending ? <Loader2 className="is-spinning" size={14} /> : <Plug size={14} />}
                        disabled={dependencyPending}
                        onClick={() => void updateSkillDependency(
                          skill,
                          `install:${skill.id}`,
                          () => onInstallSkillMcpDependencies(skill),
                        )}
                      >
                        {dependencyPending ? t('common.processing') : t('capabilities.skill.list.installDependencies')}
                      </Button>
                    ) : authDependency ? (
                      <Button
                        type="button"
                        variant="secondary"
                        icon={dependencyPending ? <Loader2 className="is-spinning" size={14} /> : <LogIn size={14} />}
                        disabled={dependencyPending}
                        onClick={() => void updateSkillDependency(
                          skill,
                          `auth:${skill.id}:${authDependency.value}`,
                          () => onAuthenticateSkillMcpDependency(skill, authDependency.value),
                        )}
                      >
                        {dependencyPending
                          ? t('capabilities.skill.awaitingAuthorization')
                          : t('capabilities.skill.list.loginDependency', { name: authDependency.value })}
                      </Button>
                    ) : null}
                    <label className="sd-check" title={t('capabilities.skill.enableHint')}>
                      <input type="checkbox" checked={skill.enabled} onChange={(event) => updateSkillEnabled(skill, event.currentTarget.checked)} />
                      <span>{t('capabilities.skill.enabled')}</span>
                    </label>
                    <label className="sd-check" title={t('capabilities.skill.defaultHint')}>
                      <input
                        type="checkbox"
                        checked={selectedByDefault}
                        disabled={!skill.enabled}
                        onChange={(event) => void onUpdateSkill(skill, { selected: event.currentTarget.checked })}
                      />
                      <span>{t('capabilities.skill.editor.default')}</span>
                    </label>
                  </div>
                </article>
                );
              })
            : null}
          {capabilityFilter === 'hooks'
            ? visibleHooks.map((hook) => {
                const canRun = hook.enabled && (hook.trustStatus === 'trusted' || hook.trustStatus === 'managed');
                const updating = updatingHookKeys.has(hook.key);
                const editable = !hook.isManaged && hook.source !== 'plugin';
                return (
                  <article className="desktop-capability-card desktop-capability-card--hook" key={`hook:${hook.key}`}>
                    <div className="desktop-capability-card__head">
                      <span className="desktop-capability-card__head-main">
                        <span className="desktop-capability-card__icon">{canRun ? <ShieldCheck size={14} /> : <ShieldAlert size={14} />}</span>
                        <span className={`desktop-capability-card__status ${canRun ? 'is-on' : ''}`}>
                          {canRun
                            ? t('capabilities.hook.executable')
                            : hook.enabled
                              ? trustStatusLabel(hook.trustStatus, t)
                              : t('capabilities.hook.disabled')}
                        </span>
                      </span>
                      <span className="desktop-capability-card__head-actions">
                        <IconButton label="Edit Hook" variant="ghost" disabled={updating || !editable} onClick={() => openHookEdit(hook)}>
                          <Pencil size={14} />
                        </IconButton>
                        <IconButton label="Delete Hook" variant="danger" disabled={updating || !editable} onClick={() => void deleteHook(hook)}>
                          <Trash2 size={14} />
                        </IconButton>
                      </span>
                    </div>
                    <h2>{hook.eventName}</h2>
                    <p className="desktop-capability-card__command" title={hook.command ?? undefined}>{hook.command || t('capabilities.hook.noCommand')}</p>
                    <div className="desktop-capability-card__meta">
                      <span>{hook.matcher ? `matcher: ${hook.matcher}` : t('capabilities.hook.allMatches')}</span>
                      <span>{hook.source}</span>
                      <span>{hook.timeoutSec}s</span>
                    </div>
                    <div className="desktop-capability-card__actions">
                      <Button
                        type="button"
                        variant="ghost"
                        icon={<ShieldCheck size={14} />}
                        disabled={updating || hook.trustStatus === 'trusted' || hook.trustStatus === 'managed'}
                        onClick={() => void updateHook(hook, () => onTrustHook(hook))}
                      >
                        {t('capabilities.hook.trust')}
                      </Button>
                      <label className="sd-check" title={t('capabilities.hook.disableHint')}>
                        <input
                          type="checkbox"
                          checked={hook.enabled}
                          disabled={updating}
                          onChange={(event) => void updateHook(hook, () => onUpdateHookEnabled(hook, event.currentTarget.checked))}
                        />
                        <span>{t('capabilities.hook.enabled')}</span>
                      </label>
                    </div>
                  </article>
                );
              })
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

function trustStatusLabel(status: RuntimeHookMetadata['trustStatus'], t: Translate): string {
  switch (status) {
    case 'managed':
      return t('capabilities.hook.managed');
    case 'trusted':
      return t('capabilities.hook.trusted');
    case 'modified':
      return t('capabilities.hook.modified');
    case 'untrusted':
    default:
      return t('capabilities.hook.untrusted');
  }
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

function setHookDraftField<TKey extends keyof HookDraft>(
  setDraft: Dispatch<SetStateAction<HookDraft>>,
  key: TKey,
  value: HookDraft[TKey],
): void {
  setDraft((draft) => ({ ...draft, [key]: value }));
}

function hookDraftToInput(draft: HookDraft): RuntimeHookInput {
  const eventOption = hookEventOptions.find((item) => item.value === draft.eventName);
  return {
    eventName: draft.eventName,
    command: draft.command.trim(),
    ...(eventOption?.matcher !== false && draft.matcher.trim() ? { matcher: draft.matcher.trim() } : {}),
    ...(draft.commandWindows.trim() ? { commandWindows: draft.commandWindows.trim() } : {}),
    ...(optionalNumber(draft.timeoutSec) ? { timeoutSec: optionalNumber(draft.timeoutSec) } : {}),
    ...(draft.statusMessage.trim() ? { statusMessage: draft.statusMessage.trim() } : {}),
  };
}

function hookConfigEventName(hook: RuntimeHookMetadata): RuntimeHookEventName {
  switch (hook.eventName) {
    case 'preToolUse':
      return 'PreToolUse';
    case 'permissionRequest':
      return 'PermissionRequest';
    case 'postToolUse':
      return 'PostToolUse';
    case 'preCompact':
      return 'PreCompact';
    case 'postCompact':
      return 'PostCompact';
    case 'sessionStart':
      return 'SessionStart';
    case 'userPromptSubmit':
      return 'UserPromptSubmit';
    case 'subagentStart':
      return 'SubagentStart';
    case 'subagentStop':
      return 'SubagentStop';
    case 'stop':
      return 'Stop';
  }
}
