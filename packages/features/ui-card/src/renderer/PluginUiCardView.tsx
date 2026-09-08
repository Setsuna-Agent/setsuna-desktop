import type { ChatToolResultViewProps } from '@setsuna-desktop/renderer-contracts/chat';
import type { RuntimePluginUiCard } from '../contracts/index.js';
import type { UiCardRendererHost } from './capabilities.js';
import './ui-card.css';

export function PluginUiCardView({
  SandboxedUiFrame,
  payload,
  plugin,
  translate,
}: ChatToolResultViewProps<RuntimePluginUiCard> & UiCardRendererHost) {
  if (!plugin || plugin.id !== payload.pluginId) {
    return (
      <div className="plugin-ui-card__unavailable" role="alert">
        {translate('feature.uiCard.invalidSource')}
      </div>
    );
  }
  return (
    <section className="plugin-ui-card" aria-label={payload.title ?? plugin.name}>
      <SandboxedUiFrame
        className="plugin-ui-card__frame"
        data={payload.data}
        source={payload}
        title={payload.title ?? plugin.name}
      />
      <footer className="plugin-ui-card__attribution">
        <span>{payload.title ?? plugin.name}</span>
        <span aria-hidden="true"> · </span>
        <span>{translate('feature.uiCard.providedBy', { name: plugin.name })}</span>
      </footer>
    </section>
  );
}
