import type { DesktopNetworkProxyServerState } from '@setsuna-desktop/contracts';
import type { RendererTranslate, SettingsViewUi } from '@setsuna-desktop/feature-core/renderer';
import { Popconfirm } from 'antd';
import { Pencil, Server, Trash2 } from 'lucide-react';

type ProxyServerCardProps = {
  disabled: boolean;
  referenced: boolean;
  server: DesktopNetworkProxyServerState;
  translate: RendererTranslate;
  ui: SettingsViewUi;
  onDelete: () => Promise<void>;
  onEdit: () => void;
};

export function ProxyServerCard({
  disabled,
  referenced,
  server,
  translate,
  ui,
  onDelete,
  onEdit,
}: ProxyServerCardProps) {
  const { IconButton } = ui;
  const credentialsConfigured = Boolean(server.username || server.passwordSet);
  const protocol = proxyProtocol(server.url);

  return (
    <article className="settings-network-proxy__server-card" role="listitem">
      <span className="settings-network-proxy__server-card-icon" aria-hidden="true">
        <Server size={16} />
      </span>

      <div className="settings-network-proxy__server-card-identity">
        <strong title={server.name}>{server.name}</strong>
        <code title={server.url}>{server.url}</code>
      </div>

      <div className="settings-network-proxy__server-card-meta">
        <span>{protocol}</span>
        <span>{translate(credentialsConfigured
          ? 'feature.networkProxy.settings.credentialsConfigured'
          : 'feature.networkProxy.settings.noCredentials')}</span>
        {referenced ? (
          <span className="is-referenced">{translate('feature.networkProxy.settings.inUse')}</span>
        ) : null}
      </div>

      <div className="settings-network-proxy__server-card-actions">
        <IconButton
          className="settings-network-proxy__server-card-edit"
          label={translate('feature.networkProxy.settings.editServer')}
          disabled={disabled}
          onClick={onEdit}
        >
          <Pencil size={13} />
        </IconButton>
        <Popconfirm
          title={translate('feature.networkProxy.settings.deleteTitle', { name: server.name })}
          description={referenced
            ? translate('feature.networkProxy.settings.deleteReferenced')
            : translate('feature.networkProxy.settings.deleteDescription')}
          okText={translate('feature.networkProxy.common.delete')}
          cancelText={translate('feature.networkProxy.common.cancel')}
          okButtonProps={{ danger: true }}
          onConfirm={onDelete}
        >
          <IconButton
            className="settings-network-proxy__server-card-delete"
            label={translate('feature.networkProxy.settings.deleteServer')}
            disabled={disabled}
          >
            <Trash2 size={13} />
          </IconButton>
        </Popconfirm>
      </div>
    </article>
  );
}

function proxyProtocol(value: string): string {
  try {
    return new URL(value).protocol.slice(0, -1).toUpperCase();
  } catch {
    return 'PROXY';
  }
}
