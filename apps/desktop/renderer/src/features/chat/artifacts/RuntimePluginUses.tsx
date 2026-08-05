import { CapabilitiesPluginIcon } from '../../capabilities/CapabilitiesPluginIcon.js';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { useRuntimePluginNavigation } from './RuntimePluginNavigation.js';
import type { RuntimePluginUse } from './runtimePluginUsage.js';

export function RuntimePluginUses({
  active,
  plugins,
}: {
  active: boolean;
  plugins: RuntimePluginUse[];
}) {
  const { t } = useI18n();
  const onOpenPlugin = useRuntimePluginNavigation();
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
        {plugins.map((plugin) => {
          const content = (
            <>
              {plugin.installed && plugin.icon
                ? <CapabilitiesPluginIcon name={plugin.icon} variant="inline" />
                : null}
              <span className="chat-plugin-use__name">{plugin.name}</span>
            </>
          );
          const title = t('chat.plugin.title', { name: plugin.name });
          return onOpenPlugin ? (
            <button
              className="chat-plugin-use"
              key={plugin.id}
              type="button"
              title={title}
              onClick={() => onOpenPlugin(plugin.id)}
            >
              {content}
            </button>
          ) : (
            <span className="chat-plugin-use" key={plugin.id} title={title}>
              {content}
            </span>
          );
        })}
      </span>
    </div>
  );
}
