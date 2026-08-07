import type {
  DesktopNetworkProxyRoute,
  DesktopNetworkProxyScope,
  DesktopNetworkProxyServerInput,
  DesktopNetworkProxyServerState,
} from '@setsuna-desktop/contracts';
import { Plus, Server } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { DesktopNetworkProxyStateView } from '../../../app/controller/useDesktopNetworkProxy.js';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { Button, EmptyState, SelectField } from '../../../shared/ui/primitives.js';
import { ProxyServerCard } from './ProxyServerCard.js';
import { ProxyServerDialog } from './ProxyServerDialog.js';

const scopeRows: Array<{ scope: DesktopNetworkProxyScope; labelKey: ScopeLabelKey; detailKey: ScopeDetailKey }> = [
  { scope: 'browser', labelKey: 'settings.proxy.scope.browser', detailKey: 'settings.proxy.scope.browserDetail' },
  { scope: 'terminal', labelKey: 'settings.proxy.scope.terminal', detailKey: 'settings.proxy.scope.terminalDetail' },
  { scope: 'updater', labelKey: 'settings.proxy.scope.updater', detailKey: 'settings.proxy.scope.updaterDetail' },
  { scope: 'runtime', labelKey: 'settings.proxy.scope.runtime', detailKey: 'settings.proxy.scope.runtimeDetail' },
];

type ScopeLabelKey =
  | 'settings.proxy.scope.browser'
  | 'settings.proxy.scope.terminal'
  | 'settings.proxy.scope.updater'
  | 'settings.proxy.scope.runtime';
type ScopeDetailKey =
  | 'settings.proxy.scope.browserDetail'
  | 'settings.proxy.scope.terminalDetail'
  | 'settings.proxy.scope.updaterDetail'
  | 'settings.proxy.scope.runtimeDetail';

type ProxyEditorTarget =
  | { kind: 'create' }
  | { kind: 'edit'; serverId: string }
  | null;

export function NetworkProxySettings({ proxy }: { proxy: DesktopNetworkProxyStateView }) {
  const { t } = useI18n();
  const [editorTarget, setEditorTarget] = useState<ProxyEditorTarget>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const state = proxy.state;

  const referencedServerIds = useMemo(() => {
    if (!state) return new Set<string>();
    const routes = [state.routing.global, ...Object.values(state.routing.scopes)];
    return new Set(routes.flatMap((route) => route.mode === 'proxy' ? [route.proxyServerId] : []));
  }, [state]);

  if (proxy.loading) return <EmptyState title={t('common.loading')} />;
  if (!state) {
    return <EmptyState title={t('settings.proxy.unavailable')} body={proxy.error ?? undefined} />;
  }

  const editingServer = editorTarget?.kind === 'edit'
    ? state.servers.find((server) => server.id === editorTarget.serverId)
    : undefined;
  const editorOpen = editorTarget?.kind === 'create' || Boolean(editingServer);

  const saveServer = async (input: DesktopNetworkProxyServerInput) => {
    setActionError(null);
    await proxy.upsertServer(input);
  };

  const deleteServer = async (server: DesktopNetworkProxyServerState) => {
    setActionError(null);
    try {
      await proxy.deleteServer(server.id);
    } catch (error) {
      setActionError(errorMessage(error));
    }
  };

  const updateRoute = async (
    scope: DesktopNetworkProxyScope | 'global',
    value: string,
  ) => {
    setActionError(null);
    const route = routeFromValue(value, scope !== 'global');
    try {
      await proxy.setRouting(scope === 'global'
        ? { global: route.mode === 'inherit' ? { mode: 'system' } : route }
        : { scopes: { [scope]: route } });
    } catch (error) {
      setActionError(errorMessage(error));
    }
  };

  const openCreateDialog = () => {
    setActionError(null);
    setEditorTarget({ kind: 'create' });
  };

  return (
    <div className="chat-user-settings__section settings-network-proxy">
      <section className="settings-network-proxy__routing settings-form-section">
        <header className="settings-network-proxy__section-head">
          <div>
            <strong>{t('settings.proxy.routingTitle')}</strong>
            <span>{t('settings.proxy.routingDescription')}</span>
          </div>
        </header>
        <div className="settings-network-proxy__route-list">
          <ProxyRouteRow
            allowInherit={false}
            disabled={proxy.busy}
            detail={t('settings.proxy.globalDetail')}
            label={t('settings.proxy.global')}
            route={state.routing.global}
            servers={state.servers}
            onChange={(value) => void updateRoute('global', value)}
          />
          {scopeRows.map((row) => (
            <ProxyRouteRow
              key={row.scope}
              allowInherit
              disabled={proxy.busy}
              detail={t(row.detailKey)}
              label={t(row.labelKey)}
              route={state.routing.scopes[row.scope]}
              servers={state.servers}
              onChange={(value) => void updateRoute(row.scope, value)}
            />
          ))}
        </div>
      </section>

      <section className="settings-network-proxy__servers settings-form-section">
        <header className="settings-network-proxy__section-head">
          <div>
            <strong>{t('settings.proxy.serversTitle')}</strong>
            <span>{t('settings.proxy.serversDescription')}</span>
          </div>
          <Button icon={<Plus size={13} />} disabled={proxy.busy} onClick={openCreateDialog}>
            {t('settings.proxy.addServer')}
          </Button>
        </header>

        {state.servers.length ? (
          <div className="settings-network-proxy__server-grid" role="list">
            {state.servers.map((server) => (
              <ProxyServerCard
                key={server.id}
                disabled={proxy.busy}
                referenced={referencedServerIds.has(server.id)}
                server={server}
                onDelete={() => deleteServer(server)}
                onEdit={() => {
                  setActionError(null);
                  setEditorTarget({ kind: 'edit', serverId: server.id });
                }}
              />
            ))}
          </div>
        ) : (
          <div className="settings-network-proxy__server-empty">
            <span aria-hidden="true"><Server size={18} /></span>
            <strong>{t('settings.proxy.noServers')}</strong>
            <small>{t('settings.proxy.noServersDescription')}</small>
          </div>
        )}

        {actionError || proxy.error ? (
          <div className="settings-network-proxy__error" role="alert">{actionError ?? proxy.error}</div>
        ) : null}
      </section>
      <p className="settings-network-proxy__footnote">{t('settings.proxy.applyNote')}</p>

      {editorOpen ? (
        <ProxyServerDialog
          key={editingServer?.id ?? 'new'}
          busy={proxy.busy}
          server={editingServer}
          onClose={() => setEditorTarget(null)}
          onSave={saveServer}
        />
      ) : null}
    </div>
  );
}

function ProxyRouteRow({
  allowInherit,
  detail,
  disabled,
  label,
  route,
  servers,
  onChange,
}: {
  allowInherit: boolean;
  detail: string;
  disabled: boolean;
  label: string;
  route: DesktopNetworkProxyRoute;
  servers: DesktopNetworkProxyServerState[];
  onChange: (value: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="settings-network-proxy__route-row">
      <span>
        <strong>{label}</strong>
        <small>{detail}</small>
      </span>
      <SelectField disabled={disabled} value={routeValue(route)} onValueChange={onChange}>
        {allowInherit ? <option value="inherit">{t('settings.proxy.route.inherit')}</option> : null}
        <option value="system">{t('settings.proxy.route.system')}</option>
        <option value="direct">{t('settings.proxy.route.direct')}</option>
        {servers.map((server) => (
          <option key={server.id} value={`proxy:${server.id}`}>{server.name}</option>
        ))}
      </SelectField>
    </div>
  );
}

function routeValue(route: DesktopNetworkProxyRoute): string {
  return route.mode === 'proxy' ? `proxy:${route.proxyServerId}` : route.mode;
}

function routeFromValue(value: string, allowInherit: boolean): DesktopNetworkProxyRoute {
  if (allowInherit && value === 'inherit') return { mode: 'inherit' };
  if (value === 'system') return { mode: 'system' };
  if (value.startsWith('proxy:')) return { mode: 'proxy', proxyServerId: value.slice('proxy:'.length) };
  return { mode: 'direct' };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
