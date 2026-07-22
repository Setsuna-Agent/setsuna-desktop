import type { RuntimePluginSummary } from '@setsuna-desktop/contracts';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { CapabilitiesPluginIcon } from './CapabilitiesPluginIcon.js';
import { localizedPluginCopy } from './pluginLocalization.js';

export function CapabilitiesInstalledPluginListItem({
  onOpen,
  plugin,
}: {
  onOpen: (plugin: RuntimePluginSummary) => void;
  plugin: RuntimePluginSummary;
}) {
  const { t } = useI18n();
  const copy = localizedPluginCopy(plugin, t);
  return (
    <article className="desktop-plugin-list-item">
      <button className="desktop-plugin-list-item__identity" type="button" onClick={() => onOpen(plugin)}>
        <CapabilitiesPluginIcon name={plugin.icon} variant="list" />
        <span className="desktop-plugin-list-item__copy">
          <strong>{copy.name}</strong>
          <span>{copy.description || t('capabilities.market.localFallback')}</span>
          <small>{plugin.publisher || t('capabilities.market.localSource')} · {t('capabilities.market.installed')}</small>
        </span>
      </button>
      <button className="desktop-plugin-market__get" type="button" onClick={() => onOpen(plugin)}>
        {t('capabilities.market.view')}
      </button>
    </article>
  );
}
