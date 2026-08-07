import type {
  DesktopNetworkProxyRoute,
  DesktopNetworkProxyServerState,
} from '@setsuna-desktop/contracts';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { SelectField } from '../../../shared/ui/primitives.js';

export function ProviderProxyField({
  proxyServers,
  route,
  onChange,
}: {
  proxyServers: DesktopNetworkProxyServerState[];
  route?: DesktopNetworkProxyRoute;
  onChange: (route: DesktopNetworkProxyRoute) => void;
}) {
  const { t } = useI18n();
  return (
    <label className="settings-provider-field settings-provider-field--proxy">
      <span className="settings-provider-field__label">
        {t('settings.providers.proxy')}
        <em>{t('settings.providers.proxyDescription')}</em>
      </span>
      <SelectField
        className="settings-local-control"
        value={routeValue(route)}
        onValueChange={(value) => onChange(routeFromValue(value))}
      >
        <option value="inherit">{t('settings.providers.proxyInherit')}</option>
        <option value="system">{t('settings.providers.proxySystem')}</option>
        <option value="direct">{t('settings.providers.proxyDirect')}</option>
        {proxyServers.map((server) => (
          <option key={server.id} value={`proxy:${server.id}`}>{server.name}</option>
        ))}
      </SelectField>
    </label>
  );
}

function routeValue(route: DesktopNetworkProxyRoute | undefined): string {
  return route?.mode === 'proxy' ? `proxy:${route.proxyServerId}` : route?.mode ?? 'inherit';
}

function routeFromValue(value: string): DesktopNetworkProxyRoute {
  if (value.startsWith('proxy:')) return { mode: 'proxy', proxyServerId: value.slice('proxy:'.length) };
  if (value === 'system') return { mode: 'system' };
  return value === 'direct' ? { mode: 'direct' } : { mode: 'inherit' };
}
