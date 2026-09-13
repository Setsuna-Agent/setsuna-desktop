import type { RuntimeMcpDeviceAuthorization } from '@setsuna-desktop/contracts';
import type { SettingsViewUi } from '@setsuna-desktop/renderer-contracts/settings';
import { Check, Copy, ExternalLink, Loader2 } from 'lucide-react';
import type { McpTranslate } from './messages.js';
import { useMcpDeviceAuthorization } from './useMcpDeviceAuthorization.js';

export function McpDeviceAuthorizationNotice({ challenge, syncingTools, openExternal, onCancel, translate, ui }: Readonly<{
  challenge?: RuntimeMcpDeviceAuthorization;
  syncingTools: boolean;
  openExternal(url: string): Promise<boolean>;
  onCancel(): void;
  translate: McpTranslate;
  ui: SettingsViewUi;
}>) {
  const authorization = useMcpDeviceAuthorization(challenge, openExternal);
  return (
    <div className="desktop-mcp-device-authorization">
      {challenge ? (
        <>
          <p className="desktop-mcp-device-authorization__instructions">{translate('feature.mcp.device.instructions')}</p>
          <div className="desktop-mcp-device-authorization__code-row">
            <code>{challenge.userCode}</code>
            <ui.IconButton label={translate(authorization.copied ? 'feature.mcp.device.copied' : 'feature.mcp.device.copy')} onClick={() => void authorization.copy()}>
              {authorization.copied ? <Check size={17} /> : <Copy size={17} />}
            </ui.IconButton>
          </div>
          {authorization.error ? <p className="desktop-mcp-device-authorization__error" role="alert">
            {translate(authorization.error === 'copy' ? 'feature.mcp.device.copyFailed' : 'feature.mcp.device.openFailed')}
            {authorization.error === 'open' ? <span>{challenge.verificationUri}</span> : null}
          </p> : null}
          <div className="desktop-mcp-device-authorization__actions">
            <ui.Button variant="primary" disabled={authorization.pending} icon={<ExternalLink size={15} />} onClick={() => void authorization.open()}>
              {translate('feature.mcp.device.open')}
            </ui.Button>
            <ui.Button variant="ghost" onClick={onCancel}>{translate('feature.mcp.device.cancel')}</ui.Button>
          </div>
          <div className="desktop-mcp-device-authorization__footer">
            <span><Loader2 size={13} className="is-spinning" aria-hidden="true" />{translate('feature.mcp.awaitingAuthorization')}</span>
            <span>{translate('feature.mcp.device.expires', { time: new Date(challenge.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })}</span>
          </div>
        </>
      ) : <>
        <span className="desktop-mcp-device-authorization__preparing" role="status"><Loader2 size={18} className="is-spinning" aria-hidden="true" />{translate(syncingTools ? 'feature.mcp.syncingTools' : 'feature.mcp.awaitingAuthorization')}</span>
        <ui.Button variant="ghost" onClick={onCancel}>{translate('feature.mcp.device.cancel')}</ui.Button>
      </>}
    </div>
  );
}
