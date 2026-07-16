import { useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { BookOpen, Boxes, FilePlus2, Info, Loader2, LogIn, LogOut, MessageSquare, Pencil, Plug, Plus, RefreshCw, Save, Search, ShieldAlert, ShieldCheck, Trash2 } from 'lucide-react';
import type { RuntimeHookEventName, RuntimeHookInput, RuntimeHookListResponse, RuntimeHookMetadata, RuntimeMcpRequireApproval, RuntimeMcpServer, RuntimeMcpServerInput, RuntimeMcpServerList, RuntimeMcpToolInfo, RuntimeMcpTransport, RuntimeMcpTrustLevel, RuntimePluginMarketplaceItem, RuntimePluginSummary, RuntimeSkillDetail, RuntimeSkillInput, RuntimeSkillSummary } from '@setsuna-desktop/contracts';
import { Button, IconButton, PageHeader, SelectField, TextArea, TextField } from '../primitives.js';
import { CapabilitiesSkillDetail } from './CapabilitiesSkillDetail.js';
import { CapabilitiesSkillEditor } from './CapabilitiesSkillEditor.js';
import { CapabilitiesPluginCard } from './CapabilitiesPluginCard.js';
import { CapabilitiesPluginMarketCard } from './CapabilitiesPluginMarketCard.js';
import { hookPresets, type HookPreset } from './hookPresets.js';

type McpDraft = {
  key: string;
  label: string;
  description: string;
  transport: RuntimeMcpTransport;
  command: string;
  args: string;
  cwd: string;
  url: string;
  env: string;
  headers: string;
  envHttpHeaders: string;
  bearerTokenEnvVar: string;
  oauthClientId: string;
  oauthResource: string;
  enabled: boolean;
  required: boolean;
  requireApproval: RuntimeMcpRequireApproval;
  trustLevel: RuntimeMcpTrustLevel;
  timeoutMs: string;
  startupTimeoutMs: string;
  toolTimeoutMs: string;
  allowedTools: string;
  disabledTools: string;
  tools: RuntimeMcpToolInfo[];
};

type HookDraft = {
  eventName: RuntimeHookEventName;
  matcher: string;
  command: string;
  commandWindows: string;
  timeoutSec: string;
  statusMessage: string;
};

const emptyMcpDraft: McpDraft = {
  key: '',
  label: '',
  description: '',
  transport: 'stdio',
  command: '',
  args: '',
  cwd: '',
  url: '',
  env: '',
  headers: '',
  envHttpHeaders: '',
  bearerTokenEnvVar: '',
  oauthClientId: '',
  oauthResource: '',
  enabled: true,
  required: false,
  requireApproval: 'auto',
  trustLevel: 'untrusted',
  timeoutMs: '',
  startupTimeoutMs: '',
  toolTimeoutMs: '',
  allowedTools: '',
  disabledTools: '',
  tools: [],
};

const emptyHookDraft: HookDraft = {
  eventName: 'PreToolUse',
  matcher: '',
  command: '',
  commandWindows: '',
  timeoutSec: '600',
  statusMessage: '',
};

const hookEventOptions: Array<{ value: RuntimeHookEventName; label: string; matcher: boolean }> = [
  { value: 'PreToolUse', label: 'PreToolUse · 工具执行前', matcher: true },
  { value: 'PermissionRequest', label: 'PermissionRequest · 权限请求时', matcher: true },
  { value: 'PostToolUse', label: 'PostToolUse · 工具成功后', matcher: true },
  { value: 'PreCompact', label: 'PreCompact · 压缩前', matcher: true },
  { value: 'PostCompact', label: 'PostCompact · 压缩后', matcher: true },
  { value: 'SessionStart', label: 'SessionStart · 会话开始', matcher: true },
  { value: 'UserPromptSubmit', label: 'UserPromptSubmit · 用户提交消息', matcher: false },
  { value: 'SubagentStart', label: 'SubagentStart · 子任务开始', matcher: true },
  { value: 'SubagentStop', label: 'SubagentStop · 子任务结束', matcher: true },
  { value: 'Stop', label: 'Stop · 回合结束', matcher: false },
];

const chatCreateSkillIds = {
  mcp: 'create-mcp-in-chat',
  skills: 'create-skill-in-chat',
} as const;

export function CapabilitiesPage({
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
  onRemovePlugin,
}: {
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
  onRemovePlugin: (pluginId: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState<McpDraft>(emptyMcpDraft);
  const [hookDraft, setHookDraft] = useState<HookDraft>(emptyHookDraft);
  const [saving, setSaving] = useState(false);
  const [hookSaving, setHookSaving] = useState(false);
  const [capabilityFilter, setCapabilityFilter] = useState<'mcp' | 'skills' | 'hooks' | 'plugins'>('mcp');
  const [capabilityQuery, setCapabilityQuery] = useState('');
  const [updatingHookKeys, setUpdatingHookKeys] = useState<Set<string>>(new Set());
  const [mcpAuthPendingKeys, setMcpAuthPendingKeys] = useState<Set<string>>(new Set());
  const [mcpEditorOpen, setMcpEditorOpen] = useState(false);
  const [hookEditorOpen, setHookEditorOpen] = useState(false);
  const [pluginSection, setPluginSection] = useState<'discover' | 'installed'>('discover');
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
  const visiblePlugins = plugins.filter((plugin) =>
    !normalizedCapabilityQuery ||
    `${plugin.name} ${plugin.description ?? ''} ${plugin.publisher ?? ''} ${plugin.tags?.join(' ') ?? ''}`.toLowerCase().includes(normalizedCapabilityQuery),
  );
  const visibleMarketplacePlugins = pluginMarketplace.filter((plugin) =>
    !normalizedCapabilityQuery ||
    `${plugin.name} ${plugin.description ?? ''} ${plugin.publisher ?? ''} ${plugin.tags.join(' ')}`.toLowerCase().includes(normalizedCapabilityQuery),
  );
  const visibleHookPresets = hookPresets.filter((preset) =>
    !normalizedCapabilityQuery ||
    `${preset.name} ${preset.description} ${preset.eventName} ${preset.matcher} ${preset.command}`.toLowerCase().includes(normalizedCapabilityQuery),
  );
  const createCapabilityKind: 'mcp' | 'skills' = capabilityFilter === 'skills' ? 'skills' : 'mcp';

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
    const confirmed = window.confirm(`确认删除本地 Skill「${skill.name}」？`);
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
      await onSaveMcpServer(mcpDraftToInput(draft, key, editingMcpServer));
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

  async function installHookPreset(preset: HookPreset) {
    setHookSaving(true);
    try {
      await onCreateHook(presetToHookInput(preset));
    } finally {
      setHookSaving(false);
    }
  }

  async function deleteHook(hook: RuntimeHookMetadata) {
    const confirmed = window.confirm(`确认删除这个 ${hookConfigEventName(hook)} Hook？`);
    if (!confirmed) return;
    await updateHook(hook, () => onDeleteHook(hook));
  }

  async function removePlugin(plugin: RuntimePluginSummary) {
    const confirmed = window.confirm(`确认卸载「${plugin.name}」？插件添加的技能、服务连接和自动化会一并移除。你的对话和项目不会受影响。`);
    if (!confirmed) return;
    setRemovingPluginIds((items) => new Set(items).add(plugin.id));
    setPluginError(null);
    try {
      await onRemovePlugin(plugin.id);
    } catch (unknownError) {
      setPluginError(pluginActionError(unknownError, '卸载插件失败，请重试。'));
    } finally {
      setRemovingPluginIds((items) => {
        const next = new Set(items);
        next.delete(plugin.id);
        return next;
      });
    }
  }

  async function installMarketplacePlugin(plugin: RuntimePluginMarketplaceItem) {
    if (plugin.installed || installingPluginIds.has(plugin.id)) return;
    setInstallingPluginIds((items) => new Set(items).add(plugin.id));
    setPluginError(null);
    try {
      await onInstallMarketplacePlugin(plugin.id);
    } catch (unknownError) {
      setPluginError(pluginActionError(unknownError, '安装插件失败，请重试。'));
    } finally {
      setInstallingPluginIds((items) => {
        const next = new Set(items);
        next.delete(plugin.id);
        return next;
      });
    }
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
              title={editingHook ? '编辑 Hook' : '创建 Hook'}
              subtitle={editingHook ? '保存修改后会重新计算 hash；命令发生变化时需要重新信任。' : 'Hook 保存后会出现在列表里。新建或改动后的命令默认不会执行，需要在列表中信任当前 hash。'}
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
                    取消
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    icon={hookSaving ? <Loader2 size={14} className="is-spinning" /> : <Save size={14} />}
                    disabled={hookSaving || !hookDraft.command.trim()}
                    onClick={() => void submitHook()}
                  >
                    {editingHook ? '保存修改' : '保存 Hook'}
                  </Button>
                </>
              }
            />
            <div className="desktop-capabilities-hook-form">
              <McpFormField className="desktop-capabilities-hook-form__full" label="触发时机">
                <SelectField
                  value={hookDraft.eventName}
                  onValueChange={(nextValue) => setHookDraftField(setHookDraft, 'eventName', nextValue as RuntimeHookEventName)}
                >
                  {hookEventOptions.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </SelectField>
              </McpFormField>
              <McpFormField className="desktop-capabilities-hook-form__full" label="Matcher" help={selectedEvent.matcher ? '正则匹配工具名或事件目标；留空表示全部匹配。' : '这个触发时机不使用 matcher，保存时会忽略。'}>
                <TextField
                  value={hookDraft.matcher}
                  disabled={!selectedEvent.matcher}
                  placeholder={selectedEvent.matcher ? '例如 Bash|apply_patch' : '不适用'}
                  onChange={(event) => setHookDraftField(setHookDraft, 'matcher', event.currentTarget.value)}
                />
              </McpFormField>
              <McpFormField className="desktop-capabilities-skill-form__full" label="macOS / Linux 命令">
                <TextArea
                  rows={3}
                  value={hookDraft.command}
                  placeholder="例如 node .codex/hooks/pre-tool-use.js"
                  onChange={(event) => setHookDraftField(setHookDraft, 'command', event.currentTarget.value)}
                />
              </McpFormField>
              <McpFormField className="desktop-capabilities-skill-form__full" label="Windows 命令" help="留空时 Windows 也使用上面的命令。">
                <TextArea
                  rows={2}
                  value={hookDraft.commandWindows}
                  placeholder="例如 powershell -File .codex/hooks/pre-tool-use.ps1"
                  onChange={(event) => setHookDraftField(setHookDraft, 'commandWindows', event.currentTarget.value)}
                />
              </McpFormField>
              <McpFormField label="超时秒数">
                <TextField
                  type="number"
                  min="1"
                  value={hookDraft.timeoutSec}
                  onChange={(event) => setHookDraftField(setHookDraft, 'timeoutSec', event.currentTarget.value)}
                />
              </McpFormField>
              <McpFormField label="状态文案">
                <TextField
                  value={hookDraft.statusMessage}
                  placeholder="运行 hook 时显示"
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

  const createConversationTitle = createCapabilityKind === 'mcp' ? '用对话安装 MCP' : '用对话创建技能';
  const createConversationDescription = createCapabilityKind === 'mcp'
    ? '打开对话并选中 MCP 创建向导。'
    : '打开对话并选中 Skill 创建向导。';
  const createFormTitle = createCapabilityKind === 'mcp' ? '手动配置 MCP' : '手动编写技能';
  const createFormDescription = createCapabilityKind === 'mcp'
    ? '直接填写命令、参数和环境变量。'
    : '直接填写名称、简介和 SKILL.md。';
  const createFormIcon = createCapabilityKind === 'mcp' ? <Plug size={14} /> : <FilePlus2 size={14} />;
  const openFormCreate = createCapabilityKind === 'mcp' ? openMcpFormCreate : openSkillFormCreate;

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
      <section className="desktop-capabilities-panel__inner">
        <header className="desktop-capabilities-header">
          <div className="desktop-capabilities-title">
            <h2>能力</h2>
          </div>
          <div className="desktop-capabilities-actions">
            <div className="desktop-capabilities-search">
              <Search size={14} />
              <input value={capabilityQuery} onChange={(event) => setCapabilityQuery(event.target.value)} placeholder="搜索能力..." />
            </div>
            <IconButton label="Refresh capabilities" onClick={() => void (capabilityFilter === 'hooks' ? onRefreshHooks() : onRefresh())}>
              <RefreshCw size={15} />
            </IconButton>
            {capabilityFilter === 'hooks' ? (
              <Button type="button" variant="primary" icon={<Plus size={14} />} onClick={openHookFormCreate}>
                创建
              </Button>
            ) : capabilityFilter === 'plugins' ? null : (
            <div className="desktop-capabilities-create">
              <Button type="button" variant="primary" icon={<Plus size={14} />} onClick={() => setCreateMenuOpen((value) => !value)}>
                创建
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
          <button className={capabilityFilter === 'mcp' ? 'is-active' : ''} type="button" onClick={() => setCapabilityFilter('mcp')}>
            MCP
          </button>
          <button className={capabilityFilter === 'skills' ? 'is-active' : ''} type="button" onClick={() => setCapabilityFilter('skills')}>
            技能
          </button>
          <button className={capabilityFilter === 'hooks' ? 'is-active' : ''} type="button" onClick={() => setCapabilityFilter('hooks')}>
            Hooks
          </button>
          <button className={capabilityFilter === 'plugins' ? 'is-active' : ''} type="button" onClick={() => setCapabilityFilter('plugins')}>
            插件
          </button>
          <span>{servers.length} MCP · {enabledSkillCount}/{skills.length} 技能启用 · {selectedSkillCount} 默认 · {executableHookCount}/{hooks.length} Hooks 可执行 · {plugins.length} 个插件</span>
        </div>

        <div className="desktop-capabilities-usage-note">
          <Info size={14} />
          <span>
            {capabilityFilter === 'mcp'
              ? '启用表示运行时会加载这个 MCP；必需是关键依赖标记，一般服务不建议开启。授权策略控制调用 MCP 工具前是否确认；可用工具和禁用工具在表单里配置。'
              : capabilityFilter === 'skills'
                ? '启用表示可在对话中选择；默认使用会把该 Skill 的 SKILL.md 正文自动加入每轮对话上下文。输入框里的 Skill 词槽只影响当前这次发送。'
                : capabilityFilter === 'hooks'
                  ? 'Hook 是本地命令触发器，会在工具调用前后运行，可用于阻止危险命令、补充上下文或审计操作。可以从推荐模板开始，也可以手动创建；保存后需要信任当前 hash 才会执行。'
                  : '从插件市场选择需要的功能，Setsuna 会自动完成校验、安装和文件管理。涉及运行命令或访问外部服务时，仍会先向你确认。'}
          </span>
        </div>

        {capabilityFilter === 'plugins' ? (
          <div className="desktop-capabilities-plugin-sections" role="tablist" aria-label="插件页面">
            <button
              className={pluginSection === 'discover' ? 'is-active' : ''}
              type="button"
              role="tab"
              aria-selected={pluginSection === 'discover'}
              onClick={() => setPluginSection('discover')}
            >
              发现
            </button>
            <button
              className={pluginSection === 'installed' ? 'is-active' : ''}
              type="button"
              role="tab"
              aria-selected={pluginSection === 'installed'}
              onClick={() => setPluginSection('installed')}
            >
              已安装 <span>{plugins.length}</span>
            </button>
          </div>
        ) : null}

        <div className="desktop-capabilities-grid">
          {capabilityFilter === 'hooks'
            ? visibleHookPresets.map((preset) => (
              <article className="desktop-capability-card desktop-capability-card--hook-preset" key={`hook-preset:${preset.id}`}>
                <div className="desktop-capability-card__head">
                  <span className="desktop-capability-card__head-main">
                    <span className="desktop-capability-card__icon"><FilePlus2 size={14} /></span>
                    <span className="desktop-capability-card__status">{preset.categoryLabel}</span>
                  </span>
                  <span className="desktop-capability-card__head-actions">
                    <IconButton label={`添加 Hook 模板：${preset.name}`} variant="ghost" disabled={hookSaving} onClick={() => void installHookPreset(preset)}>
                      <Plus size={14} />
                    </IconButton>
                  </span>
                </div>
                <h2>{preset.name}</h2>
                <p>{preset.description}</p>
                <div className="desktop-capability-card__meta">
                  <span>{preset.eventName}</span>
                  <span>{preset.matcher || '无 matcher'}</span>
                </div>
                <div className="desktop-capability-card__tool-policy">
                  <span>{preset.outcome}</span>
                  <span>{preset.recommendedFor}</span>
                </div>
              </article>
            ))
            : null}
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
                          <p title={endpoint || undefined}>{endpoint || server.description || '未配置入口'}</p>
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
                        <span>{toolStats.total ? `${toolStats.enabled}/${toolStats.total} 工具启用` : '未获取工具'}</span>
                        <span title={server.authError}>{mcpAuthStatusLabel(server.authStatus)}</span>
                      </div>
                    </div>
                    <div className="desktop-capability-card__actions desktop-capability-card__actions--mcp">
                      <div className="desktop-capability-card__mcp-setting">
                        <span className="desktop-capability-card__mcp-setting-label">服务状态</span>
                        <div className="desktop-capability-card__mcp-switches">
                          <label className="sd-check" title="启用后运行时会加载这个 MCP 服务">
                            <input type="checkbox" checked={server.enabled} disabled={server.readOnly} onChange={(event) => void onUpdateMcpServer(server, { enabled: event.currentTarget.checked })} />
                            <span>启用</span>
                          </label>
                          <label className="sd-check" title="必需是关键依赖标记，一般服务不建议开启">
                            <input type="checkbox" checked={server.required} disabled={server.readOnly} onChange={(event) => void onUpdateMcpServer(server, { required: event.currentTarget.checked })} />
                            <span>必需</span>
                          </label>
                        </div>
                      </div>
                      <div className="desktop-capability-card__mcp-setting desktop-capability-card__mcp-approval">
                        <span className="desktop-capability-card__mcp-setting-label">调用确认</span>
                        <SelectField
                          aria-label="调用确认"
                          value={server.requireApproval}
                          disabled={server.readOnly}
                          onValueChange={(nextValue) => void onUpdateMcpServer(server, { requireApproval: nextValue as RuntimeMcpRequireApproval })}
                        >
                          <option value="auto">自动判断</option>
                          <option value="prompt">每次确认</option>
                          <option value="approve">无需确认</option>
                        </SelectField>
                      </div>
                      {canUseOAuth ? (
                        <div className="desktop-capability-card__mcp-setting">
                          <span className="desktop-capability-card__mcp-setting-label">OAuth</span>
                          {server.authStatus === 'oAuth' ? (
                            <Button type="button" variant="secondary" icon={<LogOut size={14} />} disabled={authPending} onClick={() => void updateMcpAuth(server, () => onLogoutMcpServer(server))}>
                              {authPending ? '处理中' : '退出登录'}
                            </Button>
                          ) : (
                            <Button type="button" variant="secondary" icon={authPending ? <Loader2 className="is-spinning" size={14} /> : <LogIn size={14} />} disabled={authPending} onClick={() => void updateMcpAuth(server, () => onLoginMcpServer(server))}>
                              {authPending ? '等待授权' : '登录'}
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
                    <span className="desktop-capability-card__icon"><Boxes size={14} /></span>
                    <span className={`desktop-capability-card__status ${selectedByDefault ? 'is-on' : ''}`}>
                      {selectedByDefault ? '默认使用' : skill.enabled ? '已启用' : '停用'}
                    </span>
                  </div>
                  <h2>{skill.name}</h2>
                  <p>{skill.description || skill.id}</p>
                  <div className="desktop-capability-card__meta">
                    <span>{skill.id}</span>
                    {dependencies.length ? (
                      <span>{dependencies.filter((dependency) => dependency.status === 'ready').length}/{dependencies.length} MCP 就绪</span>
                    ) : null}
                    {skill.dependencyErrors?.length ? <span>依赖声明错误</span> : null}
                  </div>
                  <div className="desktop-capability-card__actions">
                    <Button type="button" variant="ghost" icon={<BookOpen size={14} />} onClick={() => void openSkillDetail(skill, 'view')}>
                      查看
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
                        {dependencyPending ? '处理中' : '安装 MCP 依赖'}
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
                        {dependencyPending ? '等待授权' : `登录 ${authDependency.value}`}
                      </Button>
                    ) : null}
                    <label className="sd-check" title="启用后可在对话中选择这个 Skill">
                      <input type="checkbox" checked={skill.enabled} onChange={(event) => updateSkillEnabled(skill, event.currentTarget.checked)} />
                      <span>启用</span>
                    </label>
                    <label className="sd-check" title="默认使用会把该 Skill 的 SKILL.md 正文自动加入每轮对话上下文">
                      <input
                        type="checkbox"
                        checked={selectedByDefault}
                        disabled={!skill.enabled}
                        onChange={(event) => void onUpdateSkill(skill, { selected: event.currentTarget.checked })}
                      />
                      <span>默认使用</span>
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
                          {canRun ? '可执行' : hook.enabled ? trustStatusLabel(hook.trustStatus) : '已停用'}
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
                    <p className="desktop-capability-card__command" title={hook.command ?? undefined}>{hook.command || '未配置命令'}</p>
                    <div className="desktop-capability-card__meta">
                      <span>{hook.matcher ? `matcher: ${hook.matcher}` : '所有匹配'}</span>
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
                        信任
                      </Button>
                      <label className="sd-check" title="停用后这个 Hook 不会参与工具调用">
                        <input
                          type="checkbox"
                          checked={hook.enabled}
                          disabled={updating}
                          onChange={(event) => void updateHook(hook, () => onUpdateHookEnabled(hook, event.currentTarget.checked))}
                        />
                        <span>启用</span>
                      </label>
                    </div>
                  </article>
                );
              })
            : null}
          {capabilityFilter === 'plugins' && pluginSection === 'discover'
            ? visibleMarketplacePlugins.map((plugin) => (
              <CapabilitiesPluginMarketCard
                key={`marketplace:${plugin.id}`}
                plugin={plugin}
                installing={installingPluginIds.has(plugin.id)}
                onInstall={installMarketplacePlugin}
              />
            ))
            : null}
          {capabilityFilter === 'plugins' && pluginSection === 'installed'
            ? visiblePlugins.map((plugin) => (
              <CapabilitiesPluginCard
                key={`plugin:${plugin.id}`}
                plugin={plugin}
                removing={removingPluginIds.has(plugin.id)}
                onRemove={removePlugin}
              />
            ))
            : null}
          {((capabilityFilter === 'mcp' && visibleServers.length)
            || (capabilityFilter === 'skills' && visibleSkills.length)
            || (capabilityFilter === 'hooks' && (visibleHookPresets.length || visibleHooks.length))
            || (capabilityFilter === 'plugins' && pluginSection === 'discover' && visibleMarketplacePlugins.length)
            || (capabilityFilter === 'plugins' && pluginSection === 'installed' && visiblePlugins.length)) ? null : (
            <div className="desktop-capabilities-empty">
              {capabilityFilter === 'plugins'
                ? pluginSection === 'discover'
                  ? normalizedCapabilityQuery ? '没有找到匹配的插件' : '插件市场暂时没有可用内容'
                  : normalizedCapabilityQuery ? '没有找到匹配的已安装插件' : '还没有安装插件，可从“发现”中选择'
                : '暂无匹配能力'}
            </div>
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

        {capabilityFilter === 'plugins' && pluginError ? (
          <div className="desktop-capabilities-errors" role="alert">{pluginError}</div>
        ) : null}

        {capabilityFilter === 'plugins' && pluginMarketplaceErrors.length ? (
          <div
            className="desktop-capabilities-errors"
            role="status"
            title={pluginMarketplaceErrors.join('\n')}
          >
            部分插件暂时无法显示，请稍后重试。
          </div>
        ) : null}

      </section>
    </main>
  );
}

function trustStatusLabel(status: RuntimeHookMetadata['trustStatus']): string {
  switch (status) {
    case 'managed':
      return '受管';
    case 'trusted':
      return '已信任';
    case 'modified':
      return '已变更';
    case 'untrusted':
    default:
      return '待信任';
  }
}

function pluginActionError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[plugins] action failed', error);
  if (/already installed/iu.test(message)) return '这个插件已经安装。';
  if (/conflict/iu.test(message)) return '这个插件与现有能力冲突，暂时无法安装。';
  if (/not found/iu.test(message)) return '这个插件已不在当前市场中，请刷新后重试。';
  return fallback;
}

function CapabilitiesMcpEditor({
  draft,
  editingMcpServer,
  saving,
  setDraft,
  onBack,
  onFetchTools,
  onSave,
}: {
  draft: McpDraft;
  editingMcpServer: RuntimeMcpServer | null;
  saving: boolean;
  setDraft: Dispatch<SetStateAction<McpDraft>>;
  onBack: () => void;
  onFetchTools: (input: RuntimeMcpServerInput) => Promise<{ tools: RuntimeMcpToolInfo[]; errors: string[] }>;
  onSave: () => Promise<void>;
}) {
  const [toolFetchLoading, setToolFetchLoading] = useState(false);
  const [toolFetchError, setToolFetchError] = useState<string | null>(null);

  async function fetchTools() {
    setToolFetchLoading(true);
    setToolFetchError(null);
    try {
      const input = mcpDraftToInput(draft, draft.key.trim() || 'preview', editingMcpServer);
      const result = await onFetchTools(input);
      if (result.errors.length) setToolFetchError(result.errors.join('\n'));
      const toolNames = result.tools.map((tool) => tool.name);
      const existingAllowed = splitList(draft.allowedTools);
      const existingDisabled = splitList(draft.disabledTools);
      setDraft((current) => ({
        ...current,
        tools: result.tools,
        allowedTools: '',
        disabledTools: (existingAllowed.length
          ? toolNames.filter((name) => !existingAllowed.includes(name))
          : existingDisabled.filter((name) => toolNames.includes(name))
        ).join('\n'),
      }));
    } catch (unknownError) {
      setToolFetchError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setToolFetchLoading(false);
    }
  }

  function setToolEnabled(toolName: string, enabled: boolean) {
    setDraft((current) => {
      const currentAllowed = splitList(current.allowedTools);
      const toolNames = current.tools.map((tool) => tool.name);
      const disabled = new Set(currentAllowed.length
        ? toolNames.filter((name) => !currentAllowed.includes(name))
        : splitList(current.disabledTools));
      if (enabled) disabled.delete(toolName);
      else disabled.add(toolName);
      return { ...current, allowedTools: '', disabledTools: [...disabled].sort((left, right) => left.localeCompare(right)).join('\n') };
    });
  }

  function setAllToolsEnabled(enabled: boolean) {
    setDraft((current) => ({
      ...current,
      allowedTools: '',
      disabledTools: enabled ? '' : current.tools.map((tool) => tool.name).join('\n'),
    }));
  }

  const allowedTools = new Set(splitList(draft.allowedTools));
  const disabledTools = new Set(splitList(draft.disabledTools));
  const toolStats = mcpToolStats(draft.tools, [...allowedTools], [...disabledTools]);
  return (
    <section className="desktop-capabilities-detail desktop-capabilities-mcp-editor">
      <PageHeader
        onBack={onBack}
        title={editingMcpServer ? editingMcpServer.label || editingMcpServer.key : '新增 MCP 服务'}
        subtitle={editingMcpServer?.readOnly ? '此配置只读，可查看但不能覆盖。' : '配置会写入本地运行时，不经过远端。'}
        actions={
          <Button
            variant="primary"
            icon={<Save size={15} />}
            disabled={saving || !draft.key.trim() || editingMcpServer?.readOnly}
            onClick={() => void onSave()}
          >
            {saving ? '保存中' : editingMcpServer ? '保存修改' : '保存'}
          </Button>
        }
      />
      <div className="mcp-form desktop-capabilities-mcp-form desktop-capabilities-mcp-form--page">
        <McpFormField label="标识" help="稳定 key，保存后不可改。">
          <TextField value={draft.key} disabled={Boolean(editingMcpServer)} onChange={(event) => setDraftField(setDraft, 'key', event.target.value)} placeholder="server-key" />
        </McpFormField>
        <McpFormField label="名称">
          <TextField value={draft.label} onChange={(event) => setDraftField(setDraft, 'label', event.target.value)} placeholder="Search MCP" />
        </McpFormField>
        <McpFormField label="传输方式">
          <SelectField
            value={draft.transport}
            onValueChange={(nextValue) => setDraftField(setDraft, 'transport', nextValue as RuntimeMcpTransport)}
          >
            <option value="stdio">stdio</option>
            <option value="streamableHttp">streamable HTTP</option>
          </SelectField>
        </McpFormField>
        <McpFormField label="授权策略" help="自动判断会根据 MCP 工具注解判断；每次确认会在每次调用前请求确认；无需确认会直接调用。">
          <SelectField
            value={draft.requireApproval}
            onValueChange={(nextValue) => setDraftField(setDraft, 'requireApproval', nextValue as RuntimeMcpRequireApproval)}
          >
            <option value="auto">自动判断</option>
            <option value="prompt">每次确认</option>
            <option value="approve">无需确认</option>
          </SelectField>
        </McpFormField>
        <McpFormField label="信任级别" help="默认不信任；只有明确可信的服务才允许只读工具依据 annotation 免确认。">
          <SelectField
            value={draft.trustLevel}
            onValueChange={(nextValue) => setDraftField(setDraft, 'trustLevel', nextValue as RuntimeMcpTrustLevel)}
          >
            <option value="untrusted">不信任（推荐）</option>
            <option value="trusted">已信任</option>
          </SelectField>
        </McpFormField>
        <McpFormField className="desktop-capabilities-mcp-form__full" label="描述">
          <TextField value={draft.description} onChange={(event) => setDraftField(setDraft, 'description', event.target.value)} placeholder="这个 MCP 提供什么能力" />
        </McpFormField>
        <div className="desktop-capabilities-mcp-form__switches">
          <label className="sd-check" title="启用后运行时会加载这个 MCP 服务">
            <input type="checkbox" checked={draft.enabled} onChange={(event) => setDraftField(setDraft, 'enabled', event.currentTarget.checked)} />
            <span>启用</span>
          </label>
          <label className="sd-check" title="必需是关键依赖标记，一般服务不建议开启">
            <input type="checkbox" checked={draft.required} onChange={(event) => setDraftField(setDraft, 'required', event.currentTarget.checked)} />
            <span>必需</span>
          </label>
          <p>启用表示运行时加载；必需表示关键依赖标记，普通可选服务保持关闭即可。</p>
        </div>
        {draft.transport === 'stdio' ? (
          <>
            <McpFormField label="命令">
              <TextField value={draft.command} onChange={(event) => setDraftField(setDraft, 'command', event.target.value)} placeholder="npx" />
            </McpFormField>
            <McpFormField className="desktop-capabilities-mcp-form__wide" label="参数" help="支持 JSON 数组、逗号或逐行填写。">
              <TextArea value={draft.args} onChange={(event) => setDraftField(setDraft, 'args', event.target.value)} placeholder={'-y\n@example/mcp'} />
            </McpFormField>
            <McpFormField label="工作目录">
              <TextField value={draft.cwd} onChange={(event) => setDraftField(setDraft, 'cwd', event.target.value)} placeholder="/path/to/project" />
            </McpFormField>
            <McpFormField className="desktop-capabilities-mcp-form__wide" label="环境变量" help={editingMcpServer?.envKeys.length ? `已有 ${editingMcpServer.envKeys.join(', ')}；值不回显，留空会保留。` : '一行一个 KEY=value，值会写入系统安全存储。'}>
              <TextArea value={draft.env} onChange={(event) => setDraftField(setDraft, 'env', event.target.value)} placeholder="API_KEY=value" />
            </McpFormField>
          </>
        ) : (
          <>
            <McpFormField className="desktop-capabilities-mcp-form__full" label="URL">
              <TextField value={draft.url} onChange={(event) => setDraftField(setDraft, 'url', event.target.value)} placeholder="https://example.com/mcp" />
            </McpFormField>
            <McpFormField className="desktop-capabilities-mcp-form__full" label="请求头" help={editingMcpServer?.headerKeys.length ? `已有 ${editingMcpServer.headerKeys.join(', ')}；值不回显，留空会保留。` : '一行一个 Header=value，值会写入系统安全存储。'}>
              <TextArea value={draft.headers} onChange={(event) => setDraftField(setDraft, 'headers', event.target.value)} placeholder="Authorization=Bearer ..." />
            </McpFormField>
            <McpFormField className="desktop-capabilities-mcp-form__full" label="环境变量请求头" help="一行一个 Header=ENV_VAR；发送时从环境变量读取值。">
              <TextArea value={draft.envHttpHeaders} onChange={(event) => setDraftField(setDraft, 'envHttpHeaders', event.target.value)} placeholder="X-API-Key=API_KEY" />
            </McpFormField>
            <McpFormField label="Bearer Token 环境变量">
              <TextField value={draft.bearerTokenEnvVar} onChange={(event) => setDraftField(setDraft, 'bearerTokenEnvVar', event.target.value)} placeholder="MCP_ACCESS_TOKEN" />
            </McpFormField>
            <McpFormField label="OAuth Client ID">
              <TextField value={draft.oauthClientId} onChange={(event) => setDraftField(setDraft, 'oauthClientId', event.target.value)} placeholder="client-id" />
            </McpFormField>
            <McpFormField className="desktop-capabilities-mcp-form__full" label="OAuth Resource">
              <TextField value={draft.oauthResource} onChange={(event) => setDraftField(setDraft, 'oauthResource', event.target.value)} placeholder="https://resource.example.com" />
            </McpFormField>
          </>
        )}
        <McpFormField label="请求超时 ms">
          <TextField value={draft.timeoutMs} onChange={(event) => setDraftField(setDraft, 'timeoutMs', event.target.value)} placeholder="120000" inputMode="numeric" />
        </McpFormField>
        <McpFormField label="启动超时 ms">
          <TextField value={draft.startupTimeoutMs} onChange={(event) => setDraftField(setDraft, 'startupTimeoutMs', event.target.value)} placeholder="120000" inputMode="numeric" />
        </McpFormField>
        <McpFormField label="工具超时 ms">
          <TextField value={draft.toolTimeoutMs} onChange={(event) => setDraftField(setDraft, 'toolTimeoutMs', event.target.value)} placeholder="120000" inputMode="numeric" />
        </McpFormField>
        <section className="desktop-capabilities-mcp-tools">
          <header>
            <div>
              <strong>工具权限</strong>
              <span>自动读取 MCP 的 tools/list，然后勾选允许使用的工具。</span>
            </div>
            <Button type="button" variant="secondary" icon={toolFetchLoading ? <Loader2 className="is-spinning" size={14} /> : <RefreshCw size={14} />} disabled={toolFetchLoading} onClick={() => void fetchTools()}>
              {toolFetchLoading ? '获取中' : '获取工具'}
            </Button>
          </header>
          {toolFetchError ? <div className="desktop-capabilities-mcp-tools__error">{toolFetchError}</div> : null}
          {draft.tools.length ? (
            <>
              <div className="desktop-capabilities-mcp-tools__toolbar">
                <button type="button" onClick={() => setAllToolsEnabled(true)}>全选</button>
                <button type="button" onClick={() => setAllToolsEnabled(false)}>全不选</button>
                <span>{toolStats.enabled}/{toolStats.total} 可用</span>
              </div>
              <div className="desktop-capabilities-mcp-tools__list">
                {draft.tools.map((tool) => {
                  const checked = (!allowedTools.size || allowedTools.has(tool.name)) && !disabledTools.has(tool.name);
                  return (
                    <label className="desktop-capabilities-mcp-tool" key={tool.name}>
                      <input type="checkbox" checked={checked} onChange={(event) => setToolEnabled(tool.name, event.currentTarget.checked)} />
                      <span>
                        <strong>{tool.name}</strong>
                        {tool.description ? <small>{tool.description}</small> : null}
                      </span>
                    </label>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="desktop-capabilities-mcp-tools__empty">填写 URL 或命令后点击获取工具。</div>
          )}
        </section>
      </div>
    </section>
  );
}

function McpFormField({
  children,
  className = '',
  help,
  label,
}: {
  children: ReactNode;
  className?: string;
  help?: string;
  label: string;
}) {
  return (
    <label className={`desktop-capabilities-mcp-field ${className}`}>
      <span>{label}</span>
      {children}
      {help ? <small>{help}</small> : null}
    </label>
  );
}

function setDraftField<TKey extends keyof McpDraft>(
  setDraft: Dispatch<SetStateAction<McpDraft>>,
  key: TKey,
  value: McpDraft[TKey],
): void {
  setDraft((draft) => ({ ...draft, [key]: value }));
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

function presetToHookInput(preset: HookPreset): RuntimeHookInput {
  return {
    eventName: preset.eventName,
    command: preset.command.trim(),
    ...(preset.matcher?.trim() ? { matcher: preset.matcher.trim() } : {}),
    ...(preset.commandWindows?.trim() ? { commandWindows: preset.commandWindows.trim() } : {}),
    ...(typeof preset.timeoutSec === 'number' ? { timeoutSec: preset.timeoutSec } : {}),
    ...(preset.statusMessage?.trim() ? { statusMessage: preset.statusMessage.trim() } : {}),
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

function mcpDraftToInput(draft: McpDraft, key: string, existing?: RuntimeMcpServer | null): RuntimeMcpServerInput {
  return {
    key,
    label: draft.label.trim() || key,
    description: optionalText(draft.description),
    transport: draft.transport,
    requireApproval: draft.requireApproval,
    trustLevel: draft.trustLevel,
    enabled: draft.enabled,
    required: draft.required,
    timeoutMs: optionalNumber(draft.timeoutMs),
    startupTimeoutMs: optionalNumber(draft.startupTimeoutMs),
    toolTimeoutMs: optionalNumber(draft.toolTimeoutMs),
    allowedTools: splitList(draft.allowedTools),
    disabledTools: splitList(draft.disabledTools),
    tools: draft.tools,
    ...(draft.transport === 'stdio'
      ? {
          command: draft.command.trim(),
          args: splitList(draft.args),
          cwd: optionalText(draft.cwd),
          ...(!existing || draft.env.trim() ? { env: keyValueLines(draft.env) } : {}),
        }
      : {
          url: draft.url.trim(),
          ...(!existing || draft.headers.trim() ? { headers: keyValueLines(draft.headers) } : {}),
          ...(draft.envHttpHeaders.trim() ? { envHttpHeaders: keyValueLines(draft.envHttpHeaders) } : {}),
          ...(draft.bearerTokenEnvVar.trim() ? { bearerTokenEnvVar: draft.bearerTokenEnvVar.trim() } : {}),
          ...(draft.oauthClientId.trim() ? { oauthClientId: draft.oauthClientId.trim() } : {}),
          ...(draft.oauthResource.trim() ? { oauthResource: draft.oauthResource.trim() } : {}),
        }),
  };
}

function splitList(value: string): string[] {
  const text = value.trim();
  if (!text) return [];
  if (text.startsWith('[')) {
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) throw new Error('启动参数必须是 JSON 数组');
    return parsed.map((item) => String(item));
  }
  return text.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
}

function optionalText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed || undefined;
}

function optionalNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : undefined;
}

function mcpToolStats(tools: RuntimeMcpToolInfo[], allowedTools: string[], disabledTools: string[]): { enabled: number; total: number } {
  const allowed = new Set(allowedTools);
  const disabled = new Set(disabledTools);
  return {
    total: tools.length,
    enabled: tools.filter((tool) => (!allowed.size || allowed.has(tool.name)) && !disabled.has(tool.name)).length,
  };
}

function mcpAuthStatusLabel(status: RuntimeMcpServer['authStatus']): string {
  switch (status) {
    case 'bearerToken':
      return 'Bearer Token';
    case 'oAuth':
      return 'OAuth 已登录';
    case 'oAuthLoggingIn':
      return 'OAuth 登录中';
    case 'oAuthExpired':
      return 'OAuth 已过期';
    case 'oAuthError':
      return 'OAuth 异常';
    case 'notLoggedIn':
      return 'OAuth 未登录';
    case 'unsupported':
    default:
      return '无需鉴权';
  }
}

function keyValueLines(value: string): Record<string, string> | undefined {
  const entries = value
    .split('\n')
    .map((line) => {
      const index = line.indexOf('=');
      if (index === -1) return null;
      const key = line.slice(0, index).trim();
      const entryValue = line.slice(index + 1).trim();
      return key && entryValue ? ([key, entryValue] as const) : null;
    })
    .filter((entry): entry is readonly [string, string] => Boolean(entry));
  return entries.length ? Object.fromEntries(entries) : undefined;
}
