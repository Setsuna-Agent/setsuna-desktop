import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { PluginIcon } from '../../../shared/ui/PluginIcon.js';
import { useRuntimePluginNavigation } from './RuntimePluginNavigation.js';
import type { RuntimePluginUse } from './runtimePluginUsage.js';

export function RuntimePluginUses({
  plugins,
}: Readonly<{
  plugins: RuntimePluginUse[];
}>) {
  const { t } = useI18n();
  const onOpenPlugin = useRuntimePluginNavigation();
  if (!plugins.length) return null;
  const status = t('chat.plugin.completed');
  return (
    <div
      className="chat-plugin-uses"
      aria-label={`${status}: ${plugins.map((plugin) => plugin.name).join(', ')}`}
    >
      {plugins.map((plugin) => {
        const content = (
          <>
            <PluginIcon name={plugin.icon} pluginId={plugin.id} variant="inline" />
            <span className="chat-plugin-use__name">{plugin.name}</span>
          </>
        );
        const title = t('chat.plugin.title', { name: plugin.name });
        return (
          <div className="chat-plugin-use-record" key={plugin.id}>
            <span className="chat-plugin-uses__status">{status}</span>
            {onOpenPlugin ? (
              <button
                className="chat-plugin-use"
                type="button"
                title={title}
                onClick={() => onOpenPlugin(plugin.id)}
              >
                {content}
              </button>
            ) : (
              <span className="chat-plugin-use" title={title}>
                {content}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
