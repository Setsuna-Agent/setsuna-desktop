import {
  completeFeatureHostActivation,
  defineRendererFeatureHost,
  rendererFeatureEventFeedCapability,
  rendererFeatureOperationTransportCapability,
  type RendererFeatureComposition,
  type ComposedRendererMessages,
} from '@setsuna-desktop/feature-core/renderer';
import {
  optionalCapability,
  provideHostCapability,
  requiredCapability,
} from '@setsuna-desktop/feature-core/capability';
import {
  artifactRendererHostCapability,
  type ArtifactRendererHost,
} from '@setsuna-desktop/feature-artifact/contracts';
import { approvalReviewRendererFeature } from '@setsuna-desktop/feature-approval-review/renderer';
import { artifactRendererFeature } from '@setsuna-desktop/feature-artifact/renderer';
import { browserRendererFeature } from '@setsuna-desktop/feature-browser/renderer';
import {
  collaborationRendererStateCapability,
  createNoopCollaborationRendererStateService,
  type CollaborationRendererStateService,
} from '@setsuna-desktop/feature-collaboration/contracts';
import { collaborationRendererFeature } from '@setsuna-desktop/feature-collaboration/renderer';
import {
  conversationDebugRendererFeature,
  conversationDebugRendererStateCapability,
  createNoopConversationDebugRendererService,
  type ConversationDebugRendererService,
} from '@setsuna-desktop/feature-conversation-debug/renderer';
import { imageGenerationRendererAssetsCapability } from '@setsuna-desktop/feature-image-generation/contracts';
import { imageGenerationRendererFeature } from '@setsuna-desktop/feature-image-generation/renderer';
import { goalRendererFeature } from '@setsuna-desktop/feature-goal/renderer';
import { memoryRendererFeature } from '@setsuna-desktop/feature-memory/renderer';
import { threadTitleGenerationRendererFeature } from '@setsuna-desktop/feature-thread-title-generation/renderer';
import {
  mcpRendererServiceCapability,
  type McpRendererService,
} from '@setsuna-desktop/feature-mcp/contracts';
import { mcpRendererFeature } from '@setsuna-desktop/feature-mcp/renderer';
import {
  modelProviderRendererFeature,
  modelProviderRendererHostCapability,
  modelProviderRendererStateCapability,
  type ModelProviderRendererStateService,
} from '@setsuna-desktop/feature-model-provider/renderer';
import {
  pluginManagementRendererHostCapability,
  pluginManagementRendererServiceCapability,
  type PluginManagementRendererService,
} from '@setsuna-desktop/feature-plugin-management/contracts';
import { pluginManagementRendererFeature } from '@setsuna-desktop/feature-plugin-management/renderer';
import { reviewRendererFeature } from '@setsuna-desktop/feature-review/renderer/feature';
import {
  runtimeActivityRendererServiceCapability,
  type RuntimeActivityRendererService,
} from '@setsuna-desktop/feature-runtime-activity/contracts';
import { runtimeActivityRendererFeature } from '@setsuna-desktop/feature-runtime-activity/renderer';
import {
  skillsRendererServiceCapability,
  type SkillsRendererService,
} from '@setsuna-desktop/feature-skills/contracts';
import { skillsRendererFeature } from '@setsuna-desktop/feature-skills/renderer';
import {
  networkProxyRendererFeature,
  networkProxyRendererHostCapability,
  networkProxyRendererStateCapability,
  type NetworkProxyRendererStateService,
} from '@setsuna-desktop/feature-network-proxy/renderer';
import { terminalRendererFeature } from '@setsuna-desktop/feature-terminal/renderer';
import {
  createNoopUsageRendererStateService,
  usageRendererStateCapability,
  type UsageRendererStateService,
} from '@setsuna-desktop/feature-usage/contracts';
import {
  usageRendererFeature,
  usageRendererHostCapability,
} from '@setsuna-desktop/feature-usage/renderer';
import {
  updaterRendererFeature,
  updaterRendererHostCapability,
  updaterRendererStateCapability,
  type UpdaterRendererStateService,
} from '@setsuna-desktop/feature-updater/renderer';
import { visionRecognitionRendererFeature } from '@setsuna-desktop/feature-vision-recognition/renderer';
import {
  webDavSyncRendererFeature,
  webDavSyncRendererHostCapability,
} from '@setsuna-desktop/feature-webdav-sync/renderer';
import { workspaceDependenciesRendererFeature } from '@setsuna-desktop/feature-workspace-dependencies/renderer';
import { workspaceAppsRendererFeature } from '@setsuna-desktop/feature-workspace-apps/renderer';
import {
  windowsSandboxRendererFeature,
  windowsSandboxRendererHostCapability,
} from '@setsuna-desktop/feature-windows-sandbox/renderer';
import { createDesktopFeatureOperationTransport } from './desktop-feature-operation-transport.js';
import {
  createRendererFeatureViews,
  type RendererFeatureViews,
} from './feature-view-registries.js';
import { RendererFeatureEventHub } from './renderer-feature-event-hub.js';
import { usageRendererHost } from './UsageFeatureBoundary.js';
import { modelProviderRendererHost } from './ModelProviderFeatureBoundary.js';
import { hostMessages } from '../shared/i18n/messages.js';
import type { AppLocale } from '../shared/i18n/I18nProvider.js';

const rendererFeatures = defineRendererFeatureHost({
  required: [
    artifactRendererFeature,
    browserRendererFeature,
    mcpRendererFeature,
    modelProviderRendererFeature,
    networkProxyRendererFeature,
    pluginManagementRendererFeature,
    reviewRendererFeature,
    runtimeActivityRendererFeature,
    skillsRendererFeature,
    terminalRendererFeature,
    updaterRendererFeature,
    windowsSandboxRendererFeature,
    workspaceAppsRendererFeature,
  ],
  optional: [
    approvalReviewRendererFeature,
    collaborationRendererFeature,
    conversationDebugRendererFeature,
    imageGenerationRendererFeature,
    goalRendererFeature,
    memoryRendererFeature,
    threadTitleGenerationRendererFeature,
    usageRendererFeature,
    visionRecognitionRendererFeature,
    webDavSyncRendererFeature,
    workspaceDependenciesRendererFeature,
  ],
});

export type ActiveRendererFeatures = Readonly<{
  collaboration: CollaborationRendererStateService;
  composition: RendererFeatureComposition;
  conversationDebug: ConversationDebugRendererService;
  messages: ComposedRendererMessages<AppLocale>;
  mcp: McpRendererService;
  modelProvider: ModelProviderRendererStateService;
  networkProxy: NetworkProxyRendererStateService;
  pluginManagement: PluginManagementRendererService;
  runtimeActivity: RuntimeActivityRendererService;
  skills: SkillsRendererService;
  updater: UpdaterRendererStateService;
  usage: UsageRendererStateService;
  views: RendererFeatureViews;
}>;

export async function activateBuiltinRendererFeatures(): Promise<ActiveRendererFeatures> {
  const runtime = window.setsunaDesktop?.runtime;
  const desktop = window.setsunaDesktop?.desktop;
  if (!runtime || !desktop) throw new Error('Desktop Feature bridge is unavailable.');
  const events = new RendererFeatureEventHub();
  const { composition, messages } = await rendererFeatures.activate({
    hostMessages,
    hostCapabilities: [
      provideHostCapability(
        artifactRendererHostCapability,
        Object.freeze({
          createWorkspaceFilePreview: typeof desktop.createWorkspaceFilePreview === 'function'
            ? (workspaceRoot, filePath) => desktop.createWorkspaceFilePreview(workspaceRoot, filePath)
            : null,
          openWorkspaceFile: typeof desktop.openWorkspaceFile === 'function'
            ? (workspaceRoot, filePath) => desktop.openWorkspaceFile(workspaceRoot, filePath)
            : null,
        } satisfies ArtifactRendererHost),
      ),
      provideHostCapability(
        modelProviderRendererHostCapability,
        Object.freeze({
          ...modelProviderRendererHost,
          networkProxyBridge: window.setsunaDesktop?.networkProxy ?? null,
        }),
      ),
      provideHostCapability(
        rendererFeatureOperationTransportCapability,
        createDesktopFeatureOperationTransport(runtime),
      ),
      provideHostCapability(
        rendererFeatureEventFeedCapability,
        events,
      ),
      provideHostCapability(
        imageGenerationRendererAssetsCapability,
        Object.freeze({
          read: (assetId: string) => desktop.readImageAsset(assetId),
          copy: (input: { assetId: string; name: string }) => desktop.copyImageToClipboard(input),
          reveal: (input: { assetId: string; name: string }) => desktop.revealImageInFolder(input),
        }),
      ),
      provideHostCapability(
        networkProxyRendererHostCapability,
        Object.freeze({ bridge: window.setsunaDesktop?.networkProxy ?? null }),
      ),
      provideHostCapability(
        pluginManagementRendererHostCapability,
        Object.freeze({ bridge: window.setsunaDesktop?.plugins ?? null }),
      ),
      provideHostCapability(
        updaterRendererHostCapability,
        Object.freeze({
          bridge: window.setsunaDesktop?.updater ?? null,
          platform: desktop.platform,
          openExternal: (url: string) => window.setsunaDesktop?.links.openExternal(url)
            ?? Promise.resolve(false),
        }),
      ),
      provideHostCapability(usageRendererHostCapability, usageRendererHost),
      provideHostCapability(
        webDavSyncRendererHostCapability,
        Object.freeze({ bridge: window.setsunaDesktop?.webdavSync ?? null }),
      ),
      provideHostCapability(
        windowsSandboxRendererHostCapability,
        Object.freeze({
          bridge: window.setsunaDesktop?.windowsSandbox ?? null,
          platform: desktop.platform,
        }),
      ),
    ],
  });
  return completeFeatureHostActivation(composition, (host) => {
    const views: RendererFeatureViews = createRendererFeatureViews(host.composition.activations(), events);
    const dependencies = host.composition.resolveHostDependencies({
      collaboration: optionalCapability(
        collaborationRendererStateCapability,
        createNoopCollaborationRendererStateService,
      ),
      conversationDebug: optionalCapability(
        conversationDebugRendererStateCapability,
        createNoopConversationDebugRendererService,
      ),
      mcp: requiredCapability(mcpRendererServiceCapability),
      networkProxy: requiredCapability(networkProxyRendererStateCapability),
      modelProvider: requiredCapability(modelProviderRendererStateCapability),
      pluginManagement: requiredCapability(pluginManagementRendererServiceCapability),
      runtimeActivity: requiredCapability(runtimeActivityRendererServiceCapability),
      skills: requiredCapability(skillsRendererServiceCapability),
      updater: requiredCapability(updaterRendererStateCapability),
      usage: optionalCapability(
        usageRendererStateCapability,
        createNoopUsageRendererStateService,
      ),
    });
    return Object.freeze({
      collaboration: dependencies.collaboration,
      composition: host.composition,
      conversationDebug: dependencies.conversationDebug,
      mcp: dependencies.mcp,
      messages,
      modelProvider: dependencies.modelProvider,
      networkProxy: dependencies.networkProxy,
      pluginManagement: dependencies.pluginManagement,
      runtimeActivity: dependencies.runtimeActivity,
      skills: dependencies.skills,
      updater: dependencies.updater,
      usage: dependencies.usage,
      views,
    });
  });
}
