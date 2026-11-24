import { declareCapabilityProvider, requiredCapability } from '@setsuna-desktop/feature-core/capability';
import { defineRendererDependencies, defineRendererFeature, rendererFeatureOperationTransportCapability } from '@setsuna-desktop/feature-core/renderer';
import { designFeature } from '../contracts/index.js';
import { createDesignClient, designAssetsCapability, designClientCapability } from './client.js';
import { designMessages } from './messages.js';

export { designAssetsCapability, designClientCapability, type DesignAssets, type DesignClient } from './client.js';
export { DesignDocumentSurface } from './DesignDocumentSurface.js';
export type { DesignWorkspaceProps } from './DesignWorkspace.js';
export { designHomeFilterForLocation, designHomeFilterForProjects, type DesignHomeFilter, type DesignWorkspaceLocation } from './catalog/design-workspace-location.js';
export { DesignWorkspaceSurface } from './DesignWorkspaceSurface.js';
export { DesignUiHostContext, type DesignShortcutSettingsProps } from './context/design-ui-host.js';

const dependencies = defineRendererDependencies({
  transport: requiredCapability(rendererFeatureOperationTransportCapability),
  assets: requiredCapability(designAssetsCapability),
});
const clientProvider = declareCapabilityProvider(designClientCapability);

export const designRendererFeature = defineRendererFeature({
  definition: designFeature,
  dependencies,
  messages: [designMessages],
  provides: [clientProvider],
  setup(context) {
    context.provide(clientProvider, createDesignClient(context.dependencies.transport, context.dependencies.assets));
  },
});

export type { DesignCanvasSelection, DesignChatBinding } from './agent/DesignChatBridge.js';
export { DesignChatFullscreenContext } from './agent/design-chat-layout.js';
