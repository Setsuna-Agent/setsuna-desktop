import type { RuntimeMcpServer } from '@setsuna-desktop/contracts';
import type { CapabilitiesPageNavigation, SettingsViewUi } from '@setsuna-desktop/renderer-contracts/settings';
import { Switch } from '@setsuna-desktop/renderer-ui';
import { ChevronDown, Pencil, Search, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { McpConnectionCard } from './McpConnectionCard.js';
import { mcpConnectionPresentation, mcpToolDisplayName } from './mcpPresentation.js';
import type { McpTranslate } from './messages.js';

export function McpServerDetail({ server, authAction, authError, onCancelLogin, openExternal, capabilities,
  onBack, onDelete, onEdit, onLogin, onLogout, onUpdate, translate, ui,
}: Readonly<{
  server: RuntimeMcpServer;
  authAction?: 'login' | 'logout';
  authError?: string;
  onCancelLogin(): void;
  openExternal(url: string): Promise<boolean>;
  capabilities?: CapabilitiesPageNavigation;
  onBack(): void;
  onDelete(): Promise<void>;
  onEdit(): void;
  onLogin(): Promise<void>;
  onLogout(): Promise<void>;
  onUpdate(enabled: boolean): Promise<unknown>;
  translate: McpTranslate;
  ui: SettingsViewUi;
}>) {
  const { name } = mcpConnectionPresentation(server);
  const seconds = (milliseconds: number) => translate('feature.mcp.detail.seconds', { count: milliseconds / 1_000 });
  return <main className="capabilities-page desktop-capabilities-panel" data-feature-id="mcp">
    <section className="desktop-capabilities-panel__inner desktop-capabilities-panel__inner--detail">
      {capabilities?.renderBreadcrumb({ currentLabel: name, parentLabel: translate('feature.mcp.title'), onBack })}
      <div className="desktop-capabilities-detail desktop-mcp-detail">
        <ui.PageHeader className="desktop-capabilities-detail__header" title={name} subtitle={translate('feature.mcp.detail.subtitle')}
          actions={<>
            <span className="sd-toggle-label"><Switch label={translate('feature.mcp.enabled')} checked={server.enabled} disabled={server.readOnly} onCheckedChange={(checked) => void onUpdate(checked)} /><span>{translate('feature.mcp.enabled')}</span></span>
            <ui.ActionMenu label={translate('feature.mcp.actions')} items={[
              { id: 'edit', label: translate('feature.mcp.edit'), icon: <Pencil size={14} />, disabled: server.readOnly },
              { id: 'delete', label: translate('feature.mcp.delete'), icon: <Trash2 size={14} />, danger: true, disabled: server.readOnly },
            ]} onSelect={(action) => { if (action === 'edit') onEdit(); if (action === 'delete') void onDelete(); }} />
          </>}
        />
        <McpConnectionCard server={server} authAction={authAction} error={authError}
          onLogin={onLogin} onLogout={onLogout} onCancel={onCancelLogin} onEdit={onEdit}
          openExternal={openExternal} translate={translate} ui={ui} />
        <div className="desktop-mcp-detail__settings">
          <McpSummary title={translate('feature.mcp.detail.configuration')} fields={[
            [translate('feature.mcp.key'), server.key],
            [translate('feature.mcp.detail.connectionType'), translate(server.transport === 'stdio' ? 'feature.mcp.detail.local' : 'feature.mcp.detail.remote')],
            [translate('feature.mcp.detail.source'), translate(`feature.mcp.source.${server.source}`)],
          ]} />
          <McpSummary title={translate('feature.mcp.detail.timeouts')} fields={[
            [translate('feature.mcp.detail.request'), seconds(server.timeoutMs)],
            [translate('feature.mcp.detail.startup'), seconds(server.startupTimeoutMs)],
            [translate('feature.mcp.detail.tool'), seconds(server.toolTimeoutMs)],
          ]} />
        </div>
        <McpToolList key={server.key} server={server} translate={translate} />
      </div>
    </section>
  </main>;
}

function McpSummary({ title, fields }: Readonly<{ title: string; fields: readonly (readonly [string, string])[] }>) {
  return <section className="desktop-mcp-detail__summary">
    <h3>{title}</h3>
    <dl>{fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
  </section>;
}

function McpToolList({ server, translate }: Readonly<{ server: RuntimeMcpServer; translate: McpTranslate }>) {
  const [query, setQuery] = useState('');
  const filter = query.trim().toLocaleLowerCase();
  const allowed = new Set(server.allowedTools);
  const disabled = new Set(server.disabledTools);
  const enabled = (name: string) => (!allowed.size || allowed.has(name)) && !disabled.has(name);
  const visibleTools = server.tools.filter((tool) => `${tool.name} ${tool.title ?? ''} ${tool.description ?? ''}`.toLocaleLowerCase().includes(filter));
  return <section className="desktop-mcp-detail__tool-section">
    <header>
      <div><h3>{translate('feature.mcp.tools')}</h3><span>{translate('feature.mcp.toolsEnabled', { enabled: server.tools.filter((tool) => enabled(tool.name)).length, total: server.tools.length })}</span></div>
      {server.tools.length ? <label className="desktop-mcp-detail__search"><Search size={14} aria-hidden="true" /><input
        aria-label={translate('feature.mcp.detail.searchTools')} placeholder={translate('feature.mcp.detail.searchTools')}
        value={query} onChange={(event) => setQuery(event.currentTarget.value)}
      /></label> : null}
    </header>
    <div className="desktop-mcp-detail__tools" tabIndex={0} role="region" aria-label={translate('feature.mcp.tools')}>
      {visibleTools.length ? visibleTools.map((tool) => <details className="desktop-mcp-detail__tool" data-disabled={!enabled(tool.name) || undefined} key={tool.name}>
        <summary>
          <div><strong>{mcpToolDisplayName(tool)}</strong>{tool.description ? <p>{tool.description}</p> : null}</div>
          <ChevronDown size={14} aria-hidden="true" />
        </summary>
        <div className="desktop-mcp-detail__tool-id"><span>{translate('feature.mcp.detail.toolId')}</span><code>{tool.name}</code></div>
      </details>) : <p className="desktop-mcp-detail__empty">{translate(server.tools.length ? 'feature.mcp.detail.noMatchingTools' : 'feature.mcp.toolsNotFetched')}</p>}
    </div>
  </section>;
}
