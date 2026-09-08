import {
  defineRendererDependencies,
  defineRendererFeature,
} from '@setsuna-desktop/feature-core/renderer';
import { requiredCapability } from '@setsuna-desktop/feature-core/capability';
import { registerChatToolResult } from '@setsuna-desktop/renderer-contracts/chat';
import {
  pluginUiCardCodec,
  PLUGIN_UI_CARD_RESULT_KIND,
  PLUGIN_UI_CARD_RESULT_MAJOR,
  uiCardFeature,
} from '../contracts/index.js';
import { uiCardRendererHostCapability } from './capabilities.js';
import { PluginUiCardView } from './PluginUiCardView.js';
import { uiCardMessages } from './messages.js';

const dependencies = defineRendererDependencies({
  host: requiredCapability(uiCardRendererHostCapability),
});

export const uiCardRendererFeature = defineRendererFeature({
  definition: uiCardFeature,
  dependencies,
  messages: [uiCardMessages],
  setup(context) {
    const { SandboxedUiFrame } = context.dependencies.host;
    registerChatToolResult(context.ui, {
      id: 'plugin.ui-card-result-view',
      resultKind: PLUGIN_UI_CARD_RESULT_KIND,
      major: PLUGIN_UI_CARD_RESULT_MAJOR,
      payload: pluginUiCardCodec,
      pluginSource: 'required',
      presentation: 'replace',
      placement: 'assistant-timeline',
      identity: (card) => `${card.pluginId}\u0000${card.id}`,
      render: (props) => (
        <PluginUiCardView {...props} SandboxedUiFrame={SandboxedUiFrame} />
      ),
    });
  },
});
