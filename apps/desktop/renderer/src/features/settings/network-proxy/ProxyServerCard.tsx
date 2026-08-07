import type { DesktopNetworkProxyServerState } from '@setsuna-desktop/contracts';
import { Popconfirm } from 'antd';
import { Pencil, Server, Trash2 } from 'lucide-react';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { IconButton } from '../../../shared/ui/primitives.js';

type ProxyServerCardProps = {
  disabled: boolean;
  referenced: boolean;
  server: DesktopNetworkProxyServerState;
  onDelete: () => Promise<void>;
  onEdit: () => void;
};

export function ProxyServerCard({
  disabled,
  referenced,
  server,
  onDelete,
  onEdit,
}: ProxyServerCardProps) {
  const { t } = useI18n();
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
        <span>{t(credentialsConfigured
          ? 'settings.proxy.credentialsConfigured'
          : 'settings.proxy.noCredentials')}</span>
        {referenced ? (
          <span className="is-referenced">{t('settings.proxy.inUse')}</span>
        ) : null}
      </div>

      <div className="settings-network-proxy__server-card-actions">
        <IconButton
          className="settings-network-proxy__server-card-edit"
          label={t('settings.proxy.editServer')}
          disabled={disabled}
          onClick={onEdit}
        >
          <Pencil size={13} />
        </IconButton>
        <Popconfirm
          title={t('settings.proxy.deleteTitle', { name: server.name })}
          description={referenced
            ? t('settings.proxy.deleteReferenced')
            : t('settings.proxy.deleteDescription')}
          okText={t('common.delete')}
          cancelText={t('common.cancel')}
          okButtonProps={{ danger: true }}
          onConfirm={onDelete}
        >
          <IconButton
            className="settings-network-proxy__server-card-delete"
            label={t('settings.proxy.deleteServer')}
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
