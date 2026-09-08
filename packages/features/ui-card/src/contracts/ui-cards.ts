import { parseRuntimePluginUiCard } from '@setsuna-desktop/contracts';
import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';

export {
  normalizePluginUiCardToolData,
  parseRuntimePluginUiCard,
  parseSandboxedUiSource,
  pluginUiCardResultEnvelope,
  PLUGIN_UI_CARD_LIMITS,
  PLUGIN_UI_CARD_RESULT_KIND,
  PLUGIN_UI_CARD_RESULT_MAJOR,
} from '@setsuna-desktop/contracts';
export type {
  RuntimePluginUiCard,
  RuntimeSandboxedUiSource,
} from '@setsuna-desktop/contracts';

export const pluginUiCardCodec = defineRuntimeCodec(parseRuntimePluginUiCard);
