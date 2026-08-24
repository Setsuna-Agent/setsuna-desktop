import type {
  DesktopNetworkProxyRoute,
  DesktopNetworkProxyScope,
  DesktopNetworkProxyServerInput,
  DesktopNetworkProxyServerState,
} from '@setsuna-desktop/contracts';
import type {
  RendererTranslate,
  SettingsViewUi,
} from '@setsuna-desktop/feature-core/renderer';
import { Plus, Server } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { NetworkProxyRendererView } from './context.js';
import { ProxyServerCard } from './ProxyServerCard.js';
import { ProxyServerDialog } from './ProxyServerDialog.js';

const scopeRows: Array<{ scope: DesktopNetworkProxyScope; labelKey: ScopeLabelKey; detailKey: ScopeDetailKey }> = [
  { scope: 'browser', labelKey: 'feature.networkProxy.settings.scope.browser', detailKey: 'feature.networkProxy.settings.scope.browserDetail' },
  { scope: 'terminal', labelKey: 'feature.networkProxy.settings.scope.terminal', detailKey: 'feature.networkProxy.settings.scope.terminalDetail' },
  { scope: 'updater', labelKey: 'feature.networkProxy.settings.scope.updater', detailKey: 'feature.networkProxy.settings.scope.updaterDetail' },
  { scope: 'runtime', labelKey: 'feature.networkProxy.settings.scope.runtime', detailKey: 'feature.networkProxy.settings.scope.runtimeDetail' },
  { scope: 'sync', labelKey: 'feature.networkProxy.settings.scope.sync', detailKey: 'feature.networkProxy.settings.scope.syncDetail' },
];

type ScopeLabelKey = `feature.networkProxy.settings.scope.${DesktopNetworkProxyScope}`;
type ScopeDetailKey = `feature.networkProxy.settings.scope.${DesktopNetworkProxyScope}Detail`;

type ProxyEditorTarget =
  | { kind: 'create' }
  | { kind: 'edit'; serverId: string }
  | null;

export function NetworkProxySettings({
  proxy,
  translate,
  ui,
}: Readonly<{
  proxy: NetworkProxyRendererView;
  translate: RendererTranslate;
  ui: SettingsViewUi;
}>) {
  const { Button, EmptyState } = ui;
  const [editorTarget, setEditorTarget] = useState<ProxyEditorTarget>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const state = proxy.state;

  const referencedServerIds = useMemo(() => {
    if (!state) return new Set<string>();
    const routes = [state.routing.global, ...Object.values(state.routing.scopes)];
    return new Set(routes.flatMap((route) => route.mode === 'proxy' ? [route.proxyServerId] : []));
  }, [state]);

  if (proxy.loading) return <EmptyState title={translate('feature.networkProxy.common.loading')} />;
  if (!state) {
    return (
      <EmptyState
        title={translate('feature.networkProxy.settings.unavailable')}
        body={proxy.error ?? undefined}
      />
    );
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
            <strong>{translate('feature.networkProxy.settings.routingTitle')}</strong>
            <span>{translate('feature.networkProxy.settings.routingDescription')}</span>
          </div>
        </header>
        <div className="settings-network-proxy__route-list">
          <ProxyRouteRow
            allowInherit={false}
            disabled={proxy.busy}
            detail={translate('feature.networkProxy.settings.globalDetail')}
            label={translate('feature.networkProxy.settings.global')}
            route={state.routing.global}
            servers={state.servers}
            translate={translate}
            ui={ui}
            onChange={(value) => void updateRoute('global', value)}
          />
          {scopeRows.map((row) => (
            <ProxyRouteRow
              key={row.scope}
              allowInherit
              disabled={proxy.busy}
              detail={translate(row.detailKey)}
              label={translate(row.labelKey)}
              route={state.routing.scopes[row.scope]}
              servers={state.servers}
              translate={translate}
              ui={ui}
              onChange={(value) => void updateRoute(row.scope, value)}
            />
          ))}
        </div>
      </section>

      <section className="settings-network-proxy__servers settings-form-section">
        <header className="settings-network-proxy__section-head">
          <div>
            <strong>{translate('feature.networkProxy.settings.serversTitle')}</strong>
            <span>{translate('feature.networkProxy.settings.serversDescription')}</span>
          </div>
          <Button icon={<Plus size={13} />} disabled={proxy.busy} onClick={openCreateDialog}>
            {translate('feature.networkProxy.settings.addServer')}
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
                translate={translate}
                ui={ui}
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
            <strong>{translate('feature.networkProxy.settings.noServers')}</strong>
            <small>{translate('feature.networkProxy.settings.noServersDescription')}</small>
          </div>
        )}

        {actionError || proxy.error ? (
          <div className="settings-network-proxy__error" role="alert">{actionError ?? proxy.error}</div>
        ) : null}
      </section>
      <p className="settings-network-proxy__footnote">
        {translate('feature.networkProxy.settings.applyNote')}
      </p>

      {editorOpen ? (
        <ProxyServerDialog
          key={editingServer?.id ?? 'new'}
          busy={proxy.busy}
          server={editingServer}
          translate={translate}
          ui={ui}
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
  translate,
  ui,
  onChange,
}: {
  allowInherit: boolean;
  detail: string;
  disabled: boolean;
  label: string;
  route: DesktopNetworkProxyRoute;
  servers: DesktopNetworkProxyServerState[];
  translate: RendererTranslate;
  ui: SettingsViewUi;
  onChange: (value: string) => void;
}) {
  const { SelectField } = ui;
  return (
    <div className="settings-network-proxy__route-row">
      <span>
        <strong>{label}</strong>
        <small>{detail}</small>
      </span>
      <SelectField disabled={disabled} value={routeValue(route)} onValueChange={onChange}>
        {allowInherit ? (
          <option value="inherit">{translate('feature.networkProxy.settings.route.inherit')}</option>
        ) : null}
        <option value="system">{translate('feature.networkProxy.settings.route.system')}</option>
        <option value="direct">{translate('feature.networkProxy.settings.route.direct')}</option>
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
