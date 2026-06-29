import { useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { BookOpen, Boxes, FilePlus2, Info, Loader2, MessageSquare, Pencil, Plug, Plus, RefreshCw, Save, Search, Trash2 } from 'lucide-react';
import type { RuntimeMcpRequireApproval, RuntimeMcpServer, RuntimeMcpServerInput, RuntimeMcpServerList, RuntimeMcpToolInfo, RuntimeMcpTransport, RuntimeSkillDetail, RuntimeSkillInput, RuntimeSkillSummary } from '@setsuna-desktop/contracts';
import { Button, IconButton, PageHeader, SelectField, TextArea, TextField } from '../primitives.js';
import { CapabilitiesSkillDetail } from './CapabilitiesSkillDetail.js';
import { CapabilitiesSkillEditor } from './CapabilitiesSkillEditor.js';

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
  enabled: true,
  required: false,
  requireApproval: 'always',
  timeoutMs: '',
  startupTimeoutMs: '',
  toolTimeoutMs: '',
  allowedTools: '',
  disabledTools: '',
  tools: [],
};

const chatCreateSkillIds = {
  mcp: 'create-mcp-in-chat',
  skills: 'create-skill-in-chat',
} as const;

export function CapabilitiesPage({
  skills,
  selectedSkillCount,
  mcpState,
  onCreateSkill,
  onDeleteSkill,
  onGetSkillDetail,
  onCreateInConversation,
  onRefresh,
  onUpdateSkill,
  onFetchMcpTools,
  onSaveMcpServer,
  onUpdateMcpServer,
  onDeleteMcpServer,
}: {
  skills: RuntimeSkillSummary[];
  selectedSkillCount: number;
  mcpState: RuntimeMcpServerList | null;
  onCreateSkill: (input: RuntimeSkillInput) => Promise<RuntimeSkillDetail>;
  onDeleteSkill: (skill: RuntimeSkillSummary) => Promise<void>;
  onGetSkillDetail: (skillId: string) => Promise<RuntimeSkillDetail>;
  onCreateInConversation: (skillId: string) => void;
  onRefresh: () => Promise<void>;
  onUpdateSkill: (skill: RuntimeSkillSummary, patch: Partial<RuntimeSkillInput>) => Promise<RuntimeSkillDetail>;
  onFetchMcpTools: (input: RuntimeMcpServerInput) => Promise<{ tools: RuntimeMcpToolInfo[]; errors: string[] }>;
  onSaveMcpServer: (input: RuntimeMcpServerInput) => Promise<void>;
  onUpdateMcpServer: (server: RuntimeMcpServer, patch: Partial<Pick<RuntimeMcpServer, 'enabled' | 'required' | 'requireApproval'>>) => Promise<void>;
  onDeleteMcpServer: (server: RuntimeMcpServer) => void;
}) {
  const [draft, setDraft] = useState<McpDraft>(emptyMcpDraft);
  const [saving, setSaving] = useState(false);
  const [capabilityFilter, setCapabilityFilter] = useState<'mcp' | 'skills'>('mcp');
  const [capabilityQuery, setCapabilityQuery] = useState('');
  const [mcpEditorOpen, setMcpEditorOpen] = useState(false);
  const [editingMcpServer, setEditingMcpServer] = useState<RuntimeMcpServer | null>(null);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [skillPageMode, setSkillPageMode] = useState<'view' | 'edit' | 'create' | null>(null);
  const [skillDetailSummary, setSkillDetailSummary] = useState<RuntimeSkillSummary | null>(null);
  const [skillDetail, setSkillDetail] = useState<RuntimeSkillDetail | null>(null);
  const [skillDetailLoading, setSkillDetailLoading] = useState(false);
  const [skillDetailError, setSkillDetailError] = useState<string | null>(null);
  const [skillSaving, setSkillSaving] = useState(false);
  const servers = mcpState?.servers ?? [];
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

  const createConversationTitle = capabilityFilter === 'mcp' ? '用对话安装 MCP' : '用对话创建技能';
  const createConversationDescription = capabilityFilter === 'mcp'
    ? '打开对话并选中 MCP 创建向导。'
    : '打开对话并选中 Skill 创建向导。';
  const createFormTitle = capabilityFilter === 'mcp' ? '手动配置 MCP' : '手动编写技能';
  const createFormDescription = capabilityFilter === 'mcp'
    ? '直接填写命令、参数和环境变量。'
    : '直接填写名称、简介和 SKILL.md。';
  const createFormIcon = capabilityFilter === 'mcp' ? <Plug size={14} /> : <FilePlus2 size={14} />;
  const openFormCreate = capabilityFilter === 'mcp' ? openMcpFormCreate : openSkillFormCreate;

  return (
    <main className="capabilities-page desktop-capabilities-panel">
      <section className="desktop-capabilities-panel__inner">
        <header className="desktop-capabilities-header">
          <div className="desktop-capabilities-title">
            <h2>能力</h2>
            <span>{mcpState?.configPath ?? 'Local runtime'}</span>
          </div>
          <div className="desktop-capabilities-actions">
            <div className="desktop-capabilities-search">
              <Search size={14} />
              <input value={capabilityQuery} onChange={(event) => setCapabilityQuery(event.target.value)} placeholder="搜索能力..." />
            </div>
            <IconButton label="Refresh capabilities" onClick={() => void onRefresh()}>
              <RefreshCw size={15} />
            </IconButton>
            <div className="desktop-capabilities-create">
              <Button type="button" variant="primary" icon={<Plus size={14} />} onClick={() => setCreateMenuOpen((value) => !value)}>
                创建
              </Button>
              {createMenuOpen ? (
                <div className="desktop-capabilities-create-menu">
                  <button className="desktop-capabilities-create-menu__item" type="button" onClick={() => openConversationCreate(capabilityFilter)}>
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
          </div>
        </header>

        <div className="desktop-capabilities-tabs">
          <button className={capabilityFilter === 'mcp' ? 'is-active' : ''} type="button" onClick={() => setCapabilityFilter('mcp')}>
            MCP
          </button>
          <button className={capabilityFilter === 'skills' ? 'is-active' : ''} type="button" onClick={() => setCapabilityFilter('skills')}>
            技能
          </button>
          <span>{servers.length} MCP · {enabledSkillCount}/{skills.length} 启用 · {selectedSkillCount} 默认使用</span>
        </div>

        <div className={`desktop-capabilities-usage-note desktop-capabilities-usage-note--${capabilityFilter}`}>
          <Info size={14} />
          <span>
            {capabilityFilter === 'mcp'
              ? '启用表示运行时会加载这个 MCP；必需是关键依赖标记，一般服务不建议开启。授权策略控制调用 MCP 工具前是否确认；可用工具和禁用工具在表单里配置。'
              : '启用表示可在对话中选择；默认使用会把该 Skill 的 SKILL.md 正文自动加入每轮对话上下文。输入框里的 Skill 词槽只影响当前这次发送。'}
          </span>
        </div>

        <div className="desktop-capabilities-grid">
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
                        onChange={(event) => void onUpdateMcpServer(server, { requireApproval: event.currentTarget.value as RuntimeMcpRequireApproval })}
                      >
                        <option value="always">总是确认</option>
                        <option value="never">无需确认</option>
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
          {((capabilityFilter === 'mcp' && visibleServers.length) || (capabilityFilter === 'skills' && visibleSkills.length)) ? null : (
            <div className="desktop-capabilities-empty">暂无匹配能力</div>
          )}
        </div>

        {mcpState?.errors.length ? (
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
            onChange={(event) => setDraftField(setDraft, 'transport', event.currentTarget.value as RuntimeMcpTransport)}
          >
            <option value="stdio">stdio</option>
            <option value="streamableHttp">streamable HTTP</option>
          </SelectField>
        </McpFormField>
        <McpFormField label="授权策略" help="总是确认会在每次 MCP 调用前请求确认；无需确认会直接调用。">
          <SelectField
            value={draft.requireApproval}
            onChange={(event) => setDraftField(setDraft, 'requireApproval', event.currentTarget.value as RuntimeMcpRequireApproval)}
          >
            <option value="always">总是确认</option>
            <option value="never">无需确认</option>
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
  return value === 'never' ? '无需确认' : '总是确认';
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
