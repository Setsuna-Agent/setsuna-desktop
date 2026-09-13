import type { RuntimePluginConnector, RuntimePluginConnectorStatus } from '@setsuna-desktop/contracts';
import type { CapabilitiesPageNavigation, SettingsViewUi } from '@setsuna-desktop/renderer-contracts/settings';
import { ExternalLink, Plug, RefreshCw, Terminal } from 'lucide-react';
import { useState } from 'react';
import type { PluginManagementRendererService } from '../contracts/index.js';
import { PluginDetailItem, PluginDetailItemIcon, PluginDetailSection } from './PluginDetailPrimitives.js';
import type { PluginManagementMessageKey, PluginManagementTranslate } from './messages.js';
import { usePluginConnectorStatuses } from './usePluginConnectorStatuses.js';

const STATE_LABELS: Record<RuntimePluginConnectorStatus['state'], PluginManagementMessageKey> = {
  missing: 'feature.pluginManagement.connector.missing',
  installed: 'feature.pluginManagement.connector.installed',
  configured: 'feature.pluginManagement.connector.configured',
  'needs-auth': 'feature.pluginManagement.connector.needsAuth',
  disabled: 'feature.pluginManagement.connector.disabled',
  error: 'feature.pluginManagement.connector.error',
};

export function PluginConnectors({ connectors, pluginId, service, capabilities, openExternal, translate, ui }: Readonly<{
  connectors: readonly RuntimePluginConnector[];
  pluginId?: string;
  service: PluginManagementRendererService;
  capabilities?: CapabilitiesPageNavigation;
  openExternal(url: string): Promise<boolean>;
  translate: PluginManagementTranslate;
  ui: SettingsViewUi;
}>) {
  const { statuses, loading, failed, refresh } = usePluginConnectorStatuses(service, pluginId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = connectors.find((connector) => connector.id === selectedId);
  const statusLabel = (connector: RuntimePluginConnector) => {
    const status = statuses.find((item) => item.connectorId === connector.id);
    return translate(!pluginId ? 'feature.pluginManagement.connector.afterInstall'
      : loading ? 'feature.pluginManagement.connector.checking'
        : failed || !status ? 'feature.pluginManagement.connector.error' : STATE_LABELS[status.state]);
  };
  return (
    <>
      <PluginDetailSection count={connectors.length} icon={<Plug size={15} />} title={translate('feature.pluginManagement.connectors')}>
        {connectors.map((connector) => (
          <PluginDetailItem
            key={connector.id}
            title={connector.name}
            description={connector.description ?? translate(connector.kind === 'cli'
              ? 'feature.pluginManagement.connector.cliDescription' : 'feature.pluginManagement.connector.mcpDescription')}
            badges={[translate(connector.required ? 'feature.pluginManagement.connector.required' : 'feature.pluginManagement.connector.optional'), statusLabel(connector)]}
            icon={<PluginDetailItemIcon>{connector.kind === 'cli' ? <Terminal size={16} /> : <Plug size={16} />}</PluginDetailItemIcon>}
            viewLabel={translate('feature.pluginManagement.connector.configure')}
            onClick={() => setSelectedId(connector.id)}
          />
        ))}
      </PluginDetailSection>
      {selected ? (
        <ui.Dialog
          title={selected.name}
          subtitle={statusLabel(selected)}
          closeLabel={translate('feature.pluginManagement.close')}
          onClose={() => setSelectedId(null)}
          footer={<ui.Button disabled={!pluginId || loading} icon={<RefreshCw size={14} />} onClick={refresh}>
            {translate('feature.pluginManagement.connector.recheck')}
          </ui.Button>}
        >
          <div className="desktop-plugin-connector-setup">
            {selected.kind === 'cli' ? (
              <>
                <p>{translate('feature.pluginManagement.connector.cliGuide', { command: selected.command })}</p>
                <ui.Button icon={<ExternalLink size={14} />} onClick={() => void openExternal(selected.installUrl)}>
                  {translate('feature.pluginManagement.connector.install')}
                </ui.Button>
                {selected.setupCommands.length ? (
                  <>
                    <p>{translate('feature.pluginManagement.connector.setupGuide')}</p>
                    <pre><code>{selected.setupCommands.join('\n')}</code></pre>
                  </>
                ) : null}
              </>
            ) : (
              <>
                <p>{translate('feature.pluginManagement.connector.mcpGuide')}</p>
                <ui.Button disabled={!pluginId || !capabilities?.openSection} onClick={() => capabilities?.openSection?.('mcp', selected.serverKey)}>
                  {translate('feature.pluginManagement.connector.configure')}
                </ui.Button>
              </>
            )}
            {selected.documentationUrl ? (
              <ui.Button variant="ghost" icon={<ExternalLink size={14} />} onClick={() => void openExternal(selected.documentationUrl!)}>
                {translate('feature.pluginManagement.connector.documentation')}
              </ui.Button>
            ) : null}
          </div>
        </ui.Dialog>
      ) : null}
    </>
  );
}
