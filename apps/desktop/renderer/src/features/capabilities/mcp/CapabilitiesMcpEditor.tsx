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
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
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
  const { t } = useI18n();
  const [toolFetchLoading, setToolFetchLoading] = useState(false);
  const [toolFetchError, setToolFetchError] = useState<string | null>(null);

  async function fetchTools() {
    setToolFetchLoading(true);
    setToolFetchError(null);
    try {
      const input = mcpDraftToInput(draft, draft.key.trim() || 'preview', editingMcpServer, t);
      const result = await onFetchTools(input);
      if (result.errors.length) setToolFetchError(result.errors.join('\n'));
      const toolNames = result.tools.map((tool) => tool.name);
      const existingAllowed = splitList(draft.allowedTools, t);
      const existingDisabled = splitList(draft.disabledTools, t);
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
      const currentAllowed = splitList(current.allowedTools, t);
      const toolNames = current.tools.map((tool) => tool.name);
      const disabled = new Set(currentAllowed.length
        ? toolNames.filter((name) => !currentAllowed.includes(name))
        : splitList(current.disabledTools, t));
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

  const allowedTools = new Set(splitList(draft.allowedTools, t));
  const disabledTools = new Set(splitList(draft.disabledTools, t));
  const toolStats = mcpToolStats(draft.tools, [...allowedTools], [...disabledTools]);
  return (
    <section className="desktop-capabilities-detail desktop-capabilities-mcp-editor">
      <PageHeader
        onBack={onBack}
        title={editingMcpServer ? editingMcpServer.label || editingMcpServer.key : t('capabilities.mcp.editor.new')}
        subtitle={t(editingMcpServer?.readOnly ? 'capabilities.mcp.editor.readOnly' : 'capabilities.mcp.editor.localOnly')}
        actions={
          <Button
            variant="primary"
            icon={<Save size={15} />}
            disabled={saving || !draft.key.trim() || editingMcpServer?.readOnly}
            onClick={() => void onSave()}
          >
            {saving ? t('capabilities.common.saving') : editingMcpServer ? t('capabilities.mcp.editor.saveChanges') : t('common.save')}
          </Button>
        }
      />
      <div className="mcp-form desktop-capabilities-mcp-form desktop-capabilities-mcp-form--page">
        <McpFormField label={t('capabilities.mcp.key')} help={t('capabilities.mcp.keyHelp')}>
          <TextField value={draft.key} disabled={Boolean(editingMcpServer)} onChange={(event) => setDraftField(setDraft, 'key', event.target.value)} placeholder="server-key" />
        </McpFormField>
        <McpFormField label={t('capabilities.mcp.name')}>
          <TextField value={draft.label} onChange={(event) => setDraftField(setDraft, 'label', event.target.value)} placeholder="Search MCP" />
        </McpFormField>
        <McpFormField label={t('capabilities.mcp.transport')}>
          <SelectField
            value={draft.transport}
            onValueChange={(nextValue) => setDraftField(setDraft, 'transport', nextValue as RuntimeMcpTransport)}
          >
            <option value="stdio">stdio</option>
            <option value="streamableHttp">streamable HTTP</option>
          </SelectField>
        </McpFormField>
        <McpFormField label={t('capabilities.mcp.approval')} help={t('capabilities.mcp.approvalHelp')}>
          <SelectField
            value={draft.requireApproval}
            onValueChange={(nextValue) => setDraftField(setDraft, 'requireApproval', nextValue as RuntimeMcpRequireApproval)}
          >
            <option value="auto">{t('capabilities.mcp.approval.auto')}</option>
            <option value="prompt">{t('capabilities.mcp.approval.prompt')}</option>
            <option value="approve">{t('capabilities.mcp.approval.approve')}</option>
          </SelectField>
        </McpFormField>
        <McpFormField label={t('capabilities.mcp.trust')} help={t('capabilities.mcp.trustHelp')}>
          <SelectField
            value={draft.trustLevel}
            onValueChange={(nextValue) => setDraftField(setDraft, 'trustLevel', nextValue as RuntimeMcpTrustLevel)}
          >
            <option value="untrusted">{t('capabilities.mcp.trust.untrusted')}</option>
            <option value="trusted">{t('capabilities.mcp.trust.trusted')}</option>
          </SelectField>
        </McpFormField>
        <McpFormField className="desktop-capabilities-mcp-form__full" label={t('capabilities.mcp.description')}>
          <TextField value={draft.description} onChange={(event) => setDraftField(setDraft, 'description', event.target.value)} placeholder={t('capabilities.mcp.descriptionPlaceholder')} />
        </McpFormField>
        <div className="desktop-capabilities-mcp-form__switches">
          <label className="sd-check" title={t('capabilities.mcp.enableHint')}>
            <input type="checkbox" checked={draft.enabled} onChange={(event) => setDraftField(setDraft, 'enabled', event.currentTarget.checked)} />
            <span>{t('capabilities.mcp.enabled')}</span>
          </label>
          <label className="sd-check" title={t('capabilities.mcp.requiredHint')}>
            <input type="checkbox" checked={draft.required} onChange={(event) => setDraftField(setDraft, 'required', event.currentTarget.checked)} />
            <span>{t('capabilities.mcp.required')}</span>
          </label>
          <p>{t('capabilities.mcp.flagsHelp')}</p>
        </div>
        {draft.transport === 'stdio' ? (
          <>
            <McpFormField label={t('capabilities.mcp.command')}>
              <TextField value={draft.command} onChange={(event) => setDraftField(setDraft, 'command', event.target.value)} placeholder="npx" />
            </McpFormField>
            <McpFormField className="desktop-capabilities-mcp-form__wide" label={t('capabilities.mcp.args')} help={t('capabilities.mcp.argsHelp')}>
              <TextArea value={draft.args} onChange={(event) => setDraftField(setDraft, 'args', event.target.value)} placeholder={'-y\n@example/mcp'} />
            </McpFormField>
            <McpFormField label={t('capabilities.mcp.cwd')}>
              <TextField value={draft.cwd} onChange={(event) => setDraftField(setDraft, 'cwd', event.target.value)} placeholder="/path/to/project" />
            </McpFormField>
            <McpFormField className="desktop-capabilities-mcp-form__wide" label={t('capabilities.mcp.env')} help={editingMcpServer?.envKeys.length ? t('capabilities.mcp.envExisting', { keys: editingMcpServer.envKeys.join(', ') }) : t('capabilities.mcp.envHelp')}>
              <TextArea value={draft.env} onChange={(event) => setDraftField(setDraft, 'env', event.target.value)} placeholder="API_KEY=value" />
            </McpFormField>
          </>
        ) : (
          <>
            <McpFormField className="desktop-capabilities-mcp-form__full" label="URL">
              <TextField value={draft.url} onChange={(event) => setDraftField(setDraft, 'url', event.target.value)} placeholder="https://example.com/mcp" />
            </McpFormField>
            <McpFormField className="desktop-capabilities-mcp-form__full" label={t('capabilities.mcp.headers')} help={editingMcpServer?.headerKeys.length ? t('capabilities.mcp.envExisting', { keys: editingMcpServer.headerKeys.join(', ') }) : t('capabilities.mcp.headersHelp')}>
              <TextArea value={draft.headers} onChange={(event) => setDraftField(setDraft, 'headers', event.target.value)} placeholder="Authorization=Bearer ..." />
            </McpFormField>
            <McpFormField className="desktop-capabilities-mcp-form__full" label={t('capabilities.mcp.envHeaders')} help={t('capabilities.mcp.envHeadersHelp')}>
              <TextArea value={draft.envHttpHeaders} onChange={(event) => setDraftField(setDraft, 'envHttpHeaders', event.target.value)} placeholder="X-API-Key=API_KEY" />
            </McpFormField>
            <McpFormField label={t('capabilities.mcp.bearerEnv')}>
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
        <McpFormField label={t('capabilities.mcp.requestTimeout')}>
          <TextField value={draft.timeoutMs} onChange={(event) => setDraftField(setDraft, 'timeoutMs', event.target.value)} placeholder="120000" inputMode="numeric" />
        </McpFormField>
        <McpFormField label={t('capabilities.mcp.startupTimeout')}>
          <TextField value={draft.startupTimeoutMs} onChange={(event) => setDraftField(setDraft, 'startupTimeoutMs', event.target.value)} placeholder="120000" inputMode="numeric" />
        </McpFormField>
        <McpFormField label={t('capabilities.mcp.toolTimeout')}>
          <TextField value={draft.toolTimeoutMs} onChange={(event) => setDraftField(setDraft, 'toolTimeoutMs', event.target.value)} placeholder="120000" inputMode="numeric" />
        </McpFormField>
        <section className="desktop-capabilities-mcp-tools">
          <header>
            <div>
              <strong>{t('capabilities.mcp.toolPermissions')}</strong>
              <span>{t('capabilities.mcp.toolPermissionsDescription')}</span>
            </div>
            <Button type="button" variant="secondary" icon={toolFetchLoading ? <Loader2 className="is-spinning" size={14} /> : <RefreshCw size={14} />} disabled={toolFetchLoading} onClick={() => void fetchTools()}>
              {t(toolFetchLoading ? 'capabilities.mcp.fetchingTools' : 'capabilities.mcp.fetchTools')}
            </Button>
          </header>
          {toolFetchError ? <div className="desktop-capabilities-mcp-tools__error">{toolFetchError}</div> : null}
          {draft.tools.length ? (
            <>
              <div className="desktop-capabilities-mcp-tools__toolbar">
                <button type="button" onClick={() => setAllToolsEnabled(true)}>{t('capabilities.mcp.selectAll')}</button>
                <button type="button" onClick={() => setAllToolsEnabled(false)}>{t('capabilities.mcp.selectNone')}</button>
                <span>{t('capabilities.mcp.toolsAvailable', { enabled: toolStats.enabled, total: toolStats.total })}</span>
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
            <div className="desktop-capabilities-mcp-tools__empty">{t('capabilities.mcp.fetchToolsHint')}</div>
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
