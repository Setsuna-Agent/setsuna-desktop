import { CapabilitiesPluginIcon } from '../../capabilities/CapabilitiesPluginIcon.js';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import type { RuntimePluginUse } from './runtimePluginUsage.js';

export function RuntimePluginUses({
  active,
  plugins,
}: {
  active: boolean;
  plugins: RuntimePluginUse[];
}) {
  const { t } = useI18n();
  if (!plugins.length) return null;
  const status = active ? t('chat.plugin.running') : t('chat.plugin.completed');
  return (
    <div
      className={`chat-plugin-uses ${active ? 'is-active' : 'is-complete'}`}
      aria-label={`${status}: ${plugins.map((plugin) => plugin.name).join(', ')}`}
      aria-live={active ? 'polite' : undefined}
    >
      <span className="chat-plugin-uses__status">{status}</span>
      <span className="chat-plugin-uses__list">
        {plugins.map((plugin) => (
          <span
            className="chat-plugin-use"
            key={plugin.id}
            title={t('chat.plugin.title', { name: plugin.name })}
          >
            <CapabilitiesPluginIcon name={plugin.icon} variant="inline" />
            <span className="chat-plugin-use__name">{plugin.name}</span>
          </span>
        ))}
      </span>
    </div>
  );
}
