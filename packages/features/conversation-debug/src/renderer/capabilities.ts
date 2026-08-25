import { defineCapability, type CapabilityToken } from '@setsuna-desktop/feature-core/capability';
import type { ConversationDebugRendererService } from './service.js';

export const conversationDebugRendererStateCapability: CapabilityToken<ConversationDebugRendererService> = defineCapability({
  id: 'conversation-debug.renderer-state',
  description: 'Renderer-owned conversation debug settings and trace access',
});
