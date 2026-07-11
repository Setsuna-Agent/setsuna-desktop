import { useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { BookOpen, Boxes, Database, FilePlus2, Info, Loader2, MessageSquare, Pencil, Play, Plug, Plus, RefreshCw, Save, Search, ShieldAlert, ShieldCheck, Trash2 } from 'lucide-react';
import type { RuntimeHookEventName, RuntimeHookInput, RuntimeHookListResponse, RuntimeHookMetadata, RuntimeMcpResourceReadResult, RuntimeMcpRequireApproval, RuntimeMcpServer, RuntimeMcpServerInput, RuntimeMcpServerList, RuntimeMcpServerStatusList, RuntimeMcpToolCallResult, RuntimeMcpToolInfo, RuntimeMcpTransport, RuntimeSkillDetail, RuntimeSkillInput, RuntimeSkillSummary } from '@setsuna-desktop/contracts';
import { Button, IconButton, PageHeader, SelectField, TextArea, TextField } from '../primitives.js';
import { CapabilitiesSkillDetail } from './CapabilitiesSkillDetail.js';
import { CapabilitiesSkillEditor } from './CapabilitiesSkillEditor.js';
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
  onCreateHook,
  onCreateSkill,
  onDeleteSkill,
  onGetSkillDetail,
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
  currentThreadId,
  onCallMcpTool,
  onListMcpServerStatuses,
  onReadMcpResource,
}: {
  skills: RuntimeSkillSummary[];
  selectedSkillCount: number;
  mcpState: RuntimeMcpServerList | null;
  hookState: RuntimeHookListResponse | null;
  onCreateHook: (input: RuntimeHookInput) => Promise<void>;
  onCreateSkill: (input: RuntimeSkillInput) => Promise<RuntimeSkillDetail>;
  onDeleteSkill: (skill: RuntimeSkillSummary) => Promise<void>;
  onGetSkillDetail: (skillId: string) => Promise<RuntimeSkillDetail>;
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
  currentThreadId?: string;
  onCallMcpTool: (server: string, tool: string, args?: unknown) => Promise<RuntimeMcpToolCallResult>;
  onListMcpServerStatuses: () => Promise<RuntimeMcpServerStatusList>;
  onReadMcpResource: (server: string, uri: string) => Promise<RuntimeMcpResourceReadResult>;
}) {
  const [draft, setDraft] = useState<McpDraft>(emptyMcpDraft);
  const [hookDraft, setHookDraft] = useState<HookDraft>(emptyHookDraft);
  const [saving, setSaving] = useState(false);
  const [hookSaving, setHookSaving] = useState(false);
  const [capabilityFilter, setCapabilityFilter] = useState<'mcp' | 'skills' | 'hooks'>('mcp');
  const [capabilityQuery, setCapabilityQuery] = useState('');
  const [updatingHookKeys, setUpdatingHookKeys] = useState<Set<string>>(new Set());
  const [mcpEditorOpen, setMcpEditorOpen] = useState(false);
  const [hookEditorOpen, setHookEditorOpen] = useState(false);
  const [editingHook, setEditingHook] = useState<RuntimeHookMetadata | null>(null);
  const [editingMcpServer, setEditingMcpServer] = useState<RuntimeMcpServer | null>(null);
  const [inspectingMcpServer, setInspectingMcpServer] = useState<RuntimeMcpServer | null>(null);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [skillPageMode, setSkillPageMode] = useState<'view' | 'edit' | 'create' | null>(null);
  const [skillDetailSummary, setSkillDetailSummary] = useState<RuntimeSkillSummary | null>(null);
  const [skillDetail, setSkillDetail] = useState<RuntimeSkillDetail | null>(null);
  const [skillDetailLoading, setSkillDetailLoading] = useState(false);
  const [skillDetailError, setSkillDetailError] = useState<string | null>(null);
  const [skillSaving, setSkillSaving] = useState(false);
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

  async function submitMcpServer() {
    const key = draft.key.trim();
    if (!key) return;
    setSaving(true);
    try {
      await onSaveMcpServer(mcpDraftToInput(draft, key));
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

  if (inspectingMcpServer) {
    return (
      <main className="capabilities-page desktop-capabilities-panel">
        <section className="desktop-capabilities-panel__inner desktop-capabilities-panel__inner--detail">
          <CapabilitiesMcpDiagnostics
            currentThreadId={currentThreadId}
            server={inspectingMcpServer}
            onBack={() => setInspectingMcpServer(null)}
            onCallTool={onCallMcpTool}
            onListStatuses={onListMcpServerStatuses}
            onReadResource={onReadMcpResource}
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
            ) : (
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
          <span>{servers.length} MCP · {enabledSkillCount}/{skills.length} 技能启用 · {selectedSkillCount} 默认 · {executableHookCount}/{hooks.length} Hooks 可执行</span>
        </div>

        <div className={`desktop-capabilities-usage-note desktop-capabilities-usage-note--${capabilityFilter}`}>
          <Info size={14} />
          <span>
            {capabilityFilter === 'mcp'
              ? '启用表示运行时会加载这个 MCP；必需是关键依赖标记，一般服务不建议开启。授权策略控制调用 MCP 工具前是否确认；可用工具和禁用工具在表单里配置。'
              : capabilityFilter === 'skills'
                ? '启用表示可在对话中选择；默认使用会把该 Skill 的 SKILL.md 正文自动加入每轮对话上下文。输入框里的 Skill 词槽只影响当前这次发送。'
                : 'Hook 是本地命令触发器，会在工具调用前后运行，可用于阻止危险命令、补充上下文或审计操作。可以从推荐模板开始，也可以手动创建；保存后需要信任当前 hash 才会执行。'}
          </span>
        </div>

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
                return (
                  <article className="desktop-capability-card desktop-capability-card--mcp" key={`mcp:${server.key}`}>
                    <div className="desktop-capability-card__head">
                      <span className="desktop-capability-card__head-main">
                        <span className="desktop-capability-card__icon"><Plug size={14} /></span>
                        <span className={`desktop-capability-card__status ${server.enabled ? 'is-on' : ''}`}>{server.enabled ? '已启用' : '已停用'}</span>
                      </span>
                      <span className="desktop-capability-card__head-actions">
                        <IconButton label="Edit MCP server" variant="ghost" onClick={() => editMcpServer(server)}>
                          <Pencil size={14} />
                        </IconButton>
                        <IconButton label="Delete MCP server" variant="danger" disabled={server.readOnly} onClick={() => onDeleteMcpServer(server)}>
                          <Trash2 size={14} />
                        </IconButton>
                      </span>
                    </div>
                    <h2>{server.label}</h2>
                    <p title={endpoint || undefined}>{endpoint || server.description || '未配置入口'}</p>
                    <div className="desktop-capability-card__meta">
                      <span>{server.key}</span>
                      <span>{server.transport}</span>
                      <span>{approvalLabel(server.requireApproval)}</span>
                    </div>
                    <div className="desktop-capability-card__tool-policy">
                      <span>{toolStats.total ? `${toolStats.enabled}/${toolStats.total} 工具启用` : '未获取工具'}</span>
                    </div>
                    <div className="desktop-capability-card__actions desktop-capability-card__actions--mcp">
                      <Button type="button" variant="ghost" icon={<Database size={13} />} onClick={() => setInspectingMcpServer(server)}>
                        资源与测试
                      </Button>
                      <label className="sd-check" title="启用后运行时会加载这个 MCP 服务">
                        <input type="checkbox" checked={server.enabled} disabled={server.readOnly} onChange={(event) => void onUpdateMcpServer(server, { enabled: event.currentTarget.checked })} />
                        <span>启用</span>
                      </label>
                      <label className="sd-check" title="必需是关键依赖标记，一般服务不建议开启">
                        <input type="checkbox" checked={server.required} disabled={server.readOnly} onChange={(event) => void onUpdateMcpServer(server, { required: event.currentTarget.checked })} />
                        <span>必需</span>
                      </label>
                      <SelectField
                        value={server.requireApproval}
                        disabled={server.readOnly}
                        onValueChange={(nextValue) => void onUpdateMcpServer(server, { requireApproval: nextValue as RuntimeMcpRequireApproval })}
                      >
                        <option value="auto">自动判断</option>
                        <option value="prompt">每次确认</option>
                        <option value="approve">无需确认</option>
                      </SelectField>
                    </div>
                  </article>
                );
              })
            : null}
          {capabilityFilter === 'skills'
            ? visibleSkills.map((skill) => {
                const selectedByDefault = skill.enabled && skill.selected;
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
                const editable = !hook.isManaged;
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
          {((capabilityFilter === 'mcp' && visibleServers.length) || (capabilityFilter === 'skills' && visibleSkills.length) || (capabilityFilter === 'hooks' && (visibleHookPresets.length || visibleHooks.length))) ? null : (
            <div className="desktop-capabilities-empty">暂无匹配能力</div>
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

function CapabilitiesMcpDiagnostics({
  currentThreadId,
  server,
  onBack,
  onCallTool,
  onListStatuses,
  onReadResource,
}: {
  currentThreadId?: string;
  server: RuntimeMcpServer;
  onBack: () => void;
  onCallTool: (server: string, tool: string, args?: unknown) => Promise<RuntimeMcpToolCallResult>;
  onListStatuses: () => Promise<RuntimeMcpServerStatusList>;
  onReadResource: (server: string, uri: string) => Promise<RuntimeMcpResourceReadResult>;
}) {
  const [status, setStatus] = useState<RuntimeMcpServerStatusList['data'][number] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [resultTitle, setResultTitle] = useState('');
  const [result, setResult] = useState<unknown>(null);
  const [toolName, setToolName] = useState(server.tools[0]?.name ?? '');
  const [toolArguments, setToolArguments] = useState('{}');
  const [calling, setCalling] = useState(false);

  const loadStatus = async () => {
    setLoading(true);
    setError('');
    try {
      const list = await onListStatuses();
      setStatus(list.data.find((item) => item.name === server.key) ?? null);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadStatus();
  }, [server.key]);

  const readResource = async (uri: string) => {
    setCalling(true);
    setError('');
    try {
      setResultTitle(uri);
      setResult(await onReadResource(server.key, uri));
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setCalling(false);
    }
  };

  const callTool = async () => {
    if (!toolName || !currentThreadId) return;
    if (!window.confirm(`确认直接调用 MCP 工具「${server.key}.${toolName}」？该调用可能修改外部数据。`)) return;
    setCalling(true);
    setError('');
    try {
      const args = toolArguments.trim() ? JSON.parse(toolArguments) : {};
      setResultTitle(`${server.key}.${toolName}`);
      setResult(await onCallTool(server.key, toolName, args));
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setCalling(false);
    }
  };

  const resources = status?.resources ?? [];
  const templates = status?.resourceTemplates ?? [];
  const tools = status ? Object.values(status.tools) : server.tools;

  return (
    <section className="desktop-capabilities-detail desktop-capabilities-mcp-diagnostics">
      <PageHeader
        title={`${server.label} · 资源与测试`}
        subtitle={`认证状态：${mcpAuthStatusLabel(status?.authStatus)}`}
        onBack={onBack}
        actions={<Button icon={loading ? <Loader2 className="is-spinning" size={14} /> : <RefreshCw size={14} />} disabled={loading} onClick={() => void loadStatus()}>刷新</Button>}
      />
      {error ? <div className="desktop-capabilities-errors"><span>{error}</span></div> : null}
      <div className="desktop-capabilities-mcp-diagnostics__grid">
        <section>
          <header><Database size={14} /><strong>Resources</strong><span>{resources.length}</span></header>
          {loading ? <div className="desktop-capabilities-mcp-tools__empty">正在读取资源…</div> : resources.length ? (
            <div className="desktop-capabilities-mcp-diagnostics__list">
              {resources.map((resource) => (
                <button key={resource.uri} type="button" disabled={calling} onClick={() => void readResource(resource.uri)}>
                  <strong>{resource.name || resource.uri}</strong>
                  <small>{resource.description || resource.uri}</small>
                </button>
              ))}
            </div>
          ) : <div className="desktop-capabilities-mcp-tools__empty">该服务没有公开静态资源。</div>}
          {templates.length ? (
            <div className="desktop-capabilities-mcp-diagnostics__templates">
              <strong>Resource templates</strong>
              {templates.map((template) => <code key={template.uriTemplate}>{template.uriTemplate}</code>)}
            </div>
          ) : null}
        </section>
        <section>
          <header><Play size={14} /><strong>测试工具调用</strong><span>{tools.length}</span></header>
          <SelectField value={toolName} onValueChange={setToolName}>
            <option value="">选择工具</option>
            {tools.map((tool) => <option key={tool.name} value={tool.name}>{tool.name}</option>)}
          </SelectField>
          <TextArea rows={8} value={toolArguments} onChange={(event) => setToolArguments(event.currentTarget.value)} placeholder={'{\n  "query": "example"\n}'} />
          <Button variant="primary" icon={calling ? <Loader2 className="is-spinning" size={14} /> : <Play size={14} />} disabled={calling || !toolName || !currentThreadId} onClick={() => void callTool()}>
            {currentThreadId ? '调用工具' : '请先打开一个对话'}
          </Button>
        </section>
      </div>
      {result !== null ? (
        <section className="desktop-capabilities-mcp-diagnostics__result">
          <header><strong>{resultTitle}</strong></header>
          <pre>{JSON.stringify(result, null, 2)}</pre>
        </section>
      ) : null}
    </section>
  );
}

function mcpAuthStatusLabel(status: RuntimeMcpServerStatusList['data'][number]['authStatus'] | undefined): string {
  if (status === 'bearerToken') return 'Bearer Token';
  if (status === 'oAuth') return 'OAuth';
  if (status === 'notLoggedIn') return '未登录';
  return '不需要或不支持认证';
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
      const input = mcpDraftToInput(draft, draft.key.trim() || 'preview');
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
            <McpFormField className="desktop-capabilities-mcp-form__wide" label="环境变量" help="一行一个 KEY=value。">
              <TextArea value={draft.env} onChange={(event) => setDraftField(setDraft, 'env', event.target.value)} placeholder="API_KEY=value" />
            </McpFormField>
          </>
        ) : (
          <>
            <McpFormField className="desktop-capabilities-mcp-form__full" label="URL">
              <TextField value={draft.url} onChange={(event) => setDraftField(setDraft, 'url', event.target.value)} placeholder="https://example.com/mcp" />
            </McpFormField>
            <McpFormField className="desktop-capabilities-mcp-form__full" label="请求头" help="一行一个 Header=value。">
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

function mcpDraftToInput(draft: McpDraft, key: string): RuntimeMcpServerInput {
  return {
    key,
    label: draft.label.trim() || key,
    description: optionalText(draft.description),
    transport: draft.transport,
    requireApproval: draft.requireApproval,
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
          env: keyValueLines(draft.env),
        }
      : {
          url: draft.url.trim(),
          headers: keyValueLines(draft.headers),
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

function approvalLabel(value: RuntimeMcpRequireApproval): string {
  if (value === 'approve' || value === 'never') return '无需确认';
  if (value === 'prompt' || value === 'always') return '每次确认';
  return '自动判断';
}

function mcpToolStats(tools: RuntimeMcpToolInfo[], allowedTools: string[], disabledTools: string[]): { enabled: number; total: number } {
  const allowed = new Set(allowedTools);
  const disabled = new Set(disabledTools);
  return {
    total: tools.length,
    enabled: tools.filter((tool) => (!allowed.size || allowed.has(tool.name)) && !disabled.has(tool.name)).length,
  };
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
