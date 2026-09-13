import type { RuntimeMcpServer } from '@setsuna-desktop/contracts';
import type { SettingsViewUi } from '@setsuna-desktop/renderer-contracts/settings';
import { Button, Dropdown } from '@setsuna-desktop/renderer-ui';
import { ChevronDown, Github, Loader2, Plug, RefreshCw, Settings2, X } from 'lucide-react';
import { McpDeviceAuthorizationNotice } from './McpDeviceAuthorizationNotice.js';
import type { McpTranslate } from './messages.js';
import { mcpConnectionPresentation } from './mcpPresentation.js';

export function McpConnectionCard({ server, authAction, error, onLogin, onLogout, onCancel, onEdit, openExternal, translate, ui }: Readonly<{
  server: RuntimeMcpServer;
  authAction?: 'login' | 'logout';
  error?: string;
  onLogin(): Promise<void>;
  onLogout(): Promise<void>;
  onCancel(): void;
  onEdit(): void;
  openExternal(url: string): Promise<boolean>;
  translate: McpTranslate;
  ui: SettingsViewUi;
}>) {
  const { github, name } = mcpConnectionPresentation(server);
  const oauthConnected = server.authStatus === 'oAuth';
  const configured = oauthConnected || server.authStatus === 'bearerToken' || server.transport === 'stdio';
  const canLogin = server.transport === 'streamableHttp'
    && !['bearerToken', 'unsupported', 'configurationError'].includes(server.authStatus ?? '');
  const busyLabel = authAction === 'logout' ? 'feature.mcp.loggingOut'
    : oauthConnected ? 'feature.mcp.syncingTools' : 'feature.mcp.connection.connecting';
  const statusLabel = server.transport === 'stdio' ? 'feature.mcp.connection.configured' : 'feature.mcp.connection.connected';
  const menu = { items: oauthConnected ? [
    { key: 'reconnect', label: translate('feature.mcp.connection.reconnect'), icon: <RefreshCw size={14} />, onClick: () => void onLogin() },
    { key: 'disconnect', label: translate('feature.mcp.connection.disconnect'), icon: <X size={14} />, danger: true, onClick: () => void onLogout() },
  ] : [
    { key: 'edit', label: translate('feature.mcp.connection.configure'), icon: <Settings2 size={14} />, disabled: server.readOnly, onClick: onEdit },
  ] };

  return <section className="desktop-mcp-connection" aria-label={translate('feature.mcp.connection')}>
    <div className="desktop-mcp-connection__row">
      <span className="desktop-mcp-connection__icon" aria-hidden="true">{github ? <Github size={22} /> : <Plug size={20} />}</span>
      <div className="desktop-mcp-connection__identity">
        <strong>{name}</strong>
        <span>{github ? translate('feature.mcp.connection.githubDescription') : server.description || translate('feature.mcp.connection.description')}</span>
      </div>
      {authAction ? <span className="desktop-mcp-connection__progress" role="status"><Loader2 size={13} className="is-spinning" aria-hidden="true" />{translate(busyLabel)}</span>
        : configured ? <Dropdown placement="bottomRight" menu={menu} rootClassName="desktop-mcp-connection-menu">
          <Button className="desktop-mcp-connection__status" aria-label={`${name} · ${translate(statusLabel)}`}>
            <span className="desktop-mcp-connection__dot" aria-hidden="true" />{translate(statusLabel)}<ChevronDown size={13} aria-hidden="true" />
          </Button>
        </Dropdown>
          : <Button className="desktop-mcp-connection__connect" variant="secondary" disabled={!canLogin && server.readOnly} onClick={() => canLogin ? void onLogin() : onEdit()}>
            {translate(canLogin ? 'feature.mcp.connection.connect' : 'feature.mcp.connection.configure')}
          </Button>}
    </div>
    {error || server.authError ? <p className="desktop-mcp-connection__error" role="alert">{error ?? server.authError}</p> : null}
    {authAction === 'login' ? <ui.Dialog
      className="desktop-mcp-auth-dialog"
      size="small"
      title={translate('feature.mcp.device.title', { name })}
      titleIcon={github ? <Github size={20} /> : <Plug size={20} />}
      closeLabel={translate('feature.mcp.device.cancel')}
      onClose={onCancel}
    >
      <McpDeviceAuthorizationNotice
        key={server.deviceAuthorization?.userCode ?? server.key}
        challenge={server.deviceAuthorization}
        syncingTools={oauthConnected}
        openExternal={openExternal}
        onCancel={onCancel}
        translate={translate}
        ui={ui}
      />
    </ui.Dialog> : null}
  </section>;
}
