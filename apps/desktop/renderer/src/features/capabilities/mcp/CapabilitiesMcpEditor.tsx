import type {
  RuntimeMcpRequireApproval,
  RuntimeMcpServer,
  RuntimeMcpServerInput,
  RuntimeMcpToolInfo,
  RuntimeMcpTransport,
  RuntimeMcpTrustLevel,
} from '@setsuna-desktop/contracts';
import { Loader2, RefreshCw, Save } from 'lucide-react';
import { useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { Button, PageHeader, SelectField, TextArea, TextField } from '../../../shared/ui/primitives.js';
import {
  mcpDraftToInput,
  mcpToolStats,
  splitList,
  type McpDraft,
} from './mcp-editor-model.js';

export function CapabilitiesMcpEditor({
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

export function McpFormField({
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
