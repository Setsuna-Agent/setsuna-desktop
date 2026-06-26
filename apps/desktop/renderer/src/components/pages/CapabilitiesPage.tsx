import { useState, type Dispatch, type SetStateAction } from 'react';
import { ArrowLeft, BookOpen, Boxes, FilePlus2, Pencil, Plug, Plus, RefreshCw, Save, Search, Trash2 } from 'lucide-react';
import type { RuntimeMcpRequireApproval, RuntimeMcpServer, RuntimeMcpServerInput, RuntimeMcpServerList, RuntimeMcpTransport, RuntimeSkillDetail, RuntimeSkillInput, RuntimeSkillSummary } from '@setsuna-desktop/contracts';
import { Button, IconButton, SelectField, TextArea, TextField } from '../primitives.js';
import { CapabilitiesSkillDetail } from './CapabilitiesSkillDetail.js';
import { CapabilitiesSkillEditor } from './CapabilitiesSkillEditor.js';

type McpDraft = {
  key: string;
  label: string;
  transport: RuntimeMcpTransport;
  command: string;
  args: string;
  cwd: string;
  url: string;
  env: string;
  headers: string;
  requireApproval: RuntimeMcpRequireApproval;
};

const emptyMcpDraft: McpDraft = {
  key: '',
  label: '',
  transport: 'stdio',
  command: '',
  args: '',
  cwd: '',
  url: '',
  env: '',
  headers: '',
  requireApproval: 'on-write',
};

export function CapabilitiesPage({
  skills,
  selectedSkillCount,
  mcpState,
  onCreateSkill,
  onDeleteSkill,
  onGetSkillDetail,
  onRefresh,
  onUpdateSkill,
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
  onRefresh: () => Promise<void>;
  onUpdateSkill: (skill: RuntimeSkillSummary, patch: Partial<RuntimeSkillInput>) => Promise<RuntimeSkillDetail>;
  onSaveMcpServer: (input: RuntimeMcpServerInput) => Promise<void>;
  onUpdateMcpServer: (server: RuntimeMcpServer, patch: Partial<Pick<RuntimeMcpServer, 'enabled' | 'required' | 'requireApproval'>>) => Promise<void>;
  onDeleteMcpServer: (server: RuntimeMcpServer) => void;
}) {
  const [draft, setDraft] = useState<McpDraft>(emptyMcpDraft);
  const [saving, setSaving] = useState(false);
  const [capabilityFilter, setCapabilityFilter] = useState<'all' | 'mcp' | 'skills'>('all');
  const [capabilityQuery, setCapabilityQuery] = useState('');
  const [editingMcpServer, setEditingMcpServer] = useState<RuntimeMcpServer | null>(null);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [skillPageMode, setSkillPageMode] = useState<'view' | 'edit' | 'create' | null>(null);
  const [skillDetailSummary, setSkillDetailSummary] = useState<RuntimeSkillSummary | null>(null);
  const [skillDetail, setSkillDetail] = useState<RuntimeSkillDetail | null>(null);
  const [skillDetailLoading, setSkillDetailLoading] = useState(false);
  const [skillDetailError, setSkillDetailError] = useState<string | null>(null);
  const [skillSaving, setSkillSaving] = useState(false);
  const servers = mcpState?.servers ?? [];
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
  }

  function openMcpCreate() {
    setCreateMenuOpen(false);
    setCapabilityFilter('mcp');
    resetMcpDraft();
    window.requestAnimationFrame(() => document.getElementById('capabilities-mcp')?.scrollIntoView({ block: 'nearest' }));
  }

  function openSkillCreate() {
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
    setDraft({
      key: server.key,
      label: server.label,
      transport: server.transport,
      command: server.command ?? '',
      args: server.args.length ? JSON.stringify(server.args, null, 2) : '',
      cwd: server.cwd ?? '',
      url: server.url ?? '',
      env: '',
      headers: '',
      requireApproval: server.requireApproval,
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
      await onSaveMcpServer({
        key,
        label: draft.label.trim() || key,
        transport: draft.transport,
        requireApproval: draft.requireApproval,
        enabled: editingMcpServer?.enabled ?? true,
        required: editingMcpServer?.required ?? false,
        timeoutMs: editingMcpServer?.timeoutMs,
        startupTimeoutMs: editingMcpServer?.startupTimeoutMs,
        toolTimeoutMs: editingMcpServer?.toolTimeoutMs,
        allowedTools: editingMcpServer?.allowedTools,
        disabledTools: editingMcpServer?.disabledTools,
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
      });
      resetMcpDraft();
    } finally {
      setSaving(false);
    }
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
                  <button className="desktop-capabilities-create-menu__item" type="button" onClick={openMcpCreate}>
                    <span className="desktop-capabilities-create-menu__icon"><Plug size={14} /></span>
                    <span className="desktop-capabilities-create-menu__content">
                      <strong>手动配置 MCP</strong>
                      <span>写入本地 MCP 配置，不请求远端。</span>
                    </span>
                  </button>
                  <button className="desktop-capabilities-create-menu__item" type="button" onClick={openSkillCreate}>
                    <span className="desktop-capabilities-create-menu__icon"><FilePlus2 size={14} /></span>
                    <span className="desktop-capabilities-create-menu__content">
                      <strong>新建本地 Skill</strong>
                      <span>保存到本机 user-skills，可立即启用。</span>
                    </span>
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <div className="desktop-capabilities-tabs">
          <button className={capabilityFilter === 'all' ? 'is-active' : ''} type="button" onClick={() => setCapabilityFilter('all')}>
            全部
          </button>
          <button className={capabilityFilter === 'mcp' ? 'is-active' : ''} type="button" onClick={() => setCapabilityFilter('mcp')}>
            MCP
          </button>
          <button className={capabilityFilter === 'skills' ? 'is-active' : ''} type="button" onClick={() => setCapabilityFilter('skills')}>
            技能
          </button>
          <span>{servers.length} MCP · {selectedSkillCount}/{skills.length} 技能</span>
        </div>

        <div className="desktop-capabilities-grid">
          {capabilityFilter !== 'skills'
            ? visibleServers.map((server) => {
                const endpoint = server.transport === 'stdio' ? [server.command, ...server.args].filter(Boolean).join(' ') : server.url;
                return (
                  <article className="desktop-capability-card" key={`mcp:${server.key}`}>
                    <div className="desktop-capability-card__head">
                      <span className="desktop-capability-card__icon"><Plug size={14} /></span>
                      <span className={`desktop-capability-card__status ${server.enabled ? 'is-on' : ''}`}>{server.enabled ? '已启用' : '已停用'}</span>
                    </div>
                    <h2>{server.label}</h2>
                    <p>{endpoint || '未配置入口'}</p>
                    <div className="desktop-capability-card__meta">
                      <span>{server.key}</span>
                      <span>{server.transport}</span>
                      <span>{server.requireApproval}</span>
                    </div>
                    <div className="desktop-capability-card__actions">
                      <label className="sd-check">
                        <input type="checkbox" checked={server.enabled} disabled={server.readOnly} onChange={(event) => void onUpdateMcpServer(server, { enabled: event.currentTarget.checked })} />
                        <span>启用</span>
                      </label>
                      <label className="sd-check">
                        <input type="checkbox" checked={server.required} disabled={server.readOnly} onChange={(event) => void onUpdateMcpServer(server, { required: event.currentTarget.checked })} />
                        <span>必需</span>
                      </label>
                      <SelectField
                        value={server.requireApproval}
                        disabled={server.readOnly}
                        onChange={(event) => void onUpdateMcpServer(server, { requireApproval: event.currentTarget.value as RuntimeMcpRequireApproval })}
                      >
                        <option value="on-write">写入确认</option>
                        <option value="always">总是确认</option>
                        <option value="never">不确认</option>
                      </SelectField>
                      <IconButton label="Delete MCP server" variant="danger" disabled={server.readOnly} onClick={() => onDeleteMcpServer(server)}>
                        <Trash2 size={14} />
                      </IconButton>
                      <IconButton label="Edit MCP server" variant="ghost" onClick={() => editMcpServer(server)}>
                        <Pencil size={14} />
                      </IconButton>
                    </div>
                  </article>
                );
              })
            : null}
          {capabilityFilter !== 'mcp'
            ? visibleSkills.map((skill) => (
                <article className="desktop-capability-card" key={`skill:${skill.id}`}>
                  <div className="desktop-capability-card__head">
                    <span className="desktop-capability-card__icon"><Boxes size={14} /></span>
                    <span className={`desktop-capability-card__status ${skill.enabled && skill.selected ? 'is-on' : ''}`}>
                      {skill.enabled && skill.selected ? '使用中' : skill.enabled ? '可用' : '停用'}
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
                    <label className="sd-check">
                      <input type="checkbox" checked={skill.enabled} onChange={(event) => void onUpdateSkill(skill, { enabled: event.currentTarget.checked })} />
                      <span>开启</span>
                    </label>
                    <label className="sd-check">
                      <input
                        type="checkbox"
                        checked={skill.selected}
                        disabled={!skill.enabled}
                        onChange={(event) => void onUpdateSkill(skill, { selected: event.currentTarget.checked })}
                      />
                      <span>使用</span>
                    </label>
                  </div>
                </article>
              ))
            : null}
          {((capabilityFilter !== 'skills' && visibleServers.length) || (capabilityFilter !== 'mcp' && visibleSkills.length)) ? null : (
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

        <section className="desktop-capabilities-detail" id="capabilities-mcp">
          <div className="desktop-capabilities-detail__head">
            <div>
              {editingMcpServer ? (
                <Button type="button" variant="ghost" icon={<ArrowLeft size={14} />} onClick={resetMcpDraft}>
                  返回
                </Button>
              ) : null}
              <h2>{editingMcpServer ? editingMcpServer.label || editingMcpServer.key : '新增 MCP 服务'}</h2>
              <span className="desktop-capabilities-detail__subtitle">
                {editingMcpServer?.readOnly ? '此配置只读，可查看但不能覆盖。' : '配置会写入本地运行时，不经过远端。'}
              </span>
            </div>
          </div>
          <div className="mcp-form desktop-capabilities-mcp-form">
            <TextField value={draft.key} disabled={Boolean(editingMcpServer)} onChange={(event) => setDraftField(setDraft, 'key', event.target.value)} placeholder="server-key" />
            <TextField value={draft.label} onChange={(event) => setDraftField(setDraft, 'label', event.target.value)} placeholder="Label" />
            <SelectField
              value={draft.transport}
              onChange={(event) => setDraftField(setDraft, 'transport', event.currentTarget.value as RuntimeMcpTransport)}
            >
              <option value="stdio">stdio</option>
              <option value="streamableHttp">streamable HTTP</option>
            </SelectField>
            <SelectField
              value={draft.requireApproval}
              onChange={(event) => setDraftField(setDraft, 'requireApproval', event.currentTarget.value as RuntimeMcpRequireApproval)}
            >
              <option value="on-write">写入确认</option>
              <option value="always">总是确认</option>
              <option value="never">不确认</option>
            </SelectField>
            {draft.transport === 'stdio' ? (
              <>
                <TextField value={draft.command} onChange={(event) => setDraftField(setDraft, 'command', event.target.value)} placeholder="Command" />
                <TextField value={draft.args} onChange={(event) => setDraftField(setDraft, 'args', event.target.value)} placeholder="Args, comma separated" />
                <TextField value={draft.cwd} onChange={(event) => setDraftField(setDraft, 'cwd', event.target.value)} placeholder="Working directory" />
                <TextArea value={draft.env} onChange={(event) => setDraftField(setDraft, 'env', event.target.value)} placeholder="ENV=value" />
              </>
            ) : (
              <>
                <TextField value={draft.url} onChange={(event) => setDraftField(setDraft, 'url', event.target.value)} placeholder="https://example.com/mcp" />
                <TextArea value={draft.headers} onChange={(event) => setDraftField(setDraft, 'headers', event.target.value)} placeholder="Header=value" />
              </>
            )}
            <Button variant="primary" icon={<Save size={15} />} disabled={saving || !draft.key.trim() || editingMcpServer?.readOnly} onClick={() => void submitMcpServer()}>
              {editingMcpServer ? '保存修改' : '保存'}
            </Button>
          </div>
        </section>
      </section>
    </main>
  );
}

function setDraftField<TKey extends keyof McpDraft>(
  setDraft: Dispatch<SetStateAction<McpDraft>>,
  key: TKey,
  value: McpDraft[TKey],
): void {
  setDraft((draft) => ({ ...draft, [key]: value }));
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
