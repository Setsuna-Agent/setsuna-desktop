import type { CollaborationRendererStateService } from '@setsuna-desktop/feature-collaboration/contracts';
import type { ConversationDebugRendererService } from '@setsuna-desktop/feature-conversation-debug/renderer';
import type { ModelProviderRendererStateService } from '@setsuna-desktop/feature-model-provider/renderer';
import type { NetworkProxyRendererStateService } from '@setsuna-desktop/feature-network-proxy/renderer';
import type { PluginManagementRendererService } from '@setsuna-desktop/feature-plugin-management/contracts';
import type { ReviewRendererService } from '@setsuna-desktop/feature-review/contracts';
import type { RuntimeActivityRendererService } from '@setsuna-desktop/feature-runtime-activity/contracts';
import type { SideConversationRendererService } from '@setsuna-desktop/feature-side-conversation/contracts';
import type { SkillsRendererService } from '@setsuna-desktop/feature-skills/contracts';
import type { UsageRendererStateService } from '@setsuna-desktop/feature-usage/contracts';
import type { CapabilitiesRefreshCoordinator } from '@setsuna-desktop/renderer-contracts/capabilities';
import type { ReactNode } from 'react';
import { CollaborationFeatureServiceBoundary } from './CollaborationFeatureBoundary.js';
import { ConversationDebugFeatureServiceBoundary } from './ConversationDebugFeatureBoundary.js';
import { CapabilitiesRefreshBoundary } from './CapabilitiesRefreshBoundary.js';
import { ModelProviderFeatureServiceBoundary } from './ModelProviderFeatureBoundary.js';
import { NetworkProxyFeatureServiceBoundary } from './NetworkProxyFeatureBoundary.js';
import { PluginManagementFeatureServiceBoundary } from './PluginManagementFeatureBoundary.js';
import { ReviewFeatureServiceBoundary } from './ReviewFeatureBoundary.js';
import { RuntimeActivityFeatureServiceBoundary } from './RuntimeActivityFeatureBoundary.js';
import { SideConversationFeatureServiceBoundary } from './SideConversationFeatureBoundary.js';
import { SkillsFeatureServiceBoundary } from './SkillsFeatureBoundary.js';
import { UsageFeatureServiceBoundary } from './UsageFeatureBoundary.js';

export type BuiltinRendererFeatureServices = Readonly<{
  collaboration: CollaborationRendererStateService;
  capabilitiesRefresh: CapabilitiesRefreshCoordinator;
  conversationDebug: ConversationDebugRendererService;
  modelProvider: ModelProviderRendererStateService;
  networkProxy: NetworkProxyRendererStateService;
  pluginManagement: PluginManagementRendererService;
  review: ReviewRendererService;
  runtimeActivity: RuntimeActivityRendererService;
  sideConversation: SideConversationRendererService;
  skills: SkillsRendererService;
  usage: UsageRendererStateService;
}>;

/**
 * The composition root owns Feature service wiring. Keeping this aggregate out
 * of main.tsx prevents bootstrap from becoming a second business inventory.
 */
export function BuiltinRendererFeatureServicesBoundary({
  children,
  services,
}: Readonly<{
  children: ReactNode;
  services: BuiltinRendererFeatureServices;
}>) {
  return (
    <CapabilitiesRefreshBoundary coordinator={services.capabilitiesRefresh}>
      <NetworkProxyFeatureServiceBoundary service={services.networkProxy}>
        <ModelProviderFeatureServiceBoundary service={services.modelProvider}>
          <ConversationDebugFeatureServiceBoundary service={services.conversationDebug}>
            <CollaborationFeatureServiceBoundary service={services.collaboration}>
              <SideConversationFeatureServiceBoundary service={services.sideConversation}>
                <ReviewFeatureServiceBoundary service={services.review}>
                  <UsageFeatureServiceBoundary service={services.usage}>
                    <RuntimeActivityFeatureServiceBoundary service={services.runtimeActivity}>
                      <PluginManagementFeatureServiceBoundary service={services.pluginManagement}>
                        <SkillsFeatureServiceBoundary service={services.skills}>
                          {children}
                        </SkillsFeatureServiceBoundary>
                      </PluginManagementFeatureServiceBoundary>
                    </RuntimeActivityFeatureServiceBoundary>
                  </UsageFeatureServiceBoundary>
                </ReviewFeatureServiceBoundary>
              </SideConversationFeatureServiceBoundary>
            </CollaborationFeatureServiceBoundary>
          </ConversationDebugFeatureServiceBoundary>
        </ModelProviderFeatureServiceBoundary>
      </NetworkProxyFeatureServiceBoundary>
    </CapabilitiesRefreshBoundary>
  );
}
