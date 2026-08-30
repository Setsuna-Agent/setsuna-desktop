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
} from '@setsuna-desktop/feature-collaboration/contracts';
import { collaborationRendererFeature } from '@setsuna-desktop/feature-collaboration/renderer';
import {
  conversationDebugRendererFeature,
  conversationDebugRendererStateCapability,
  createNoopConversationDebugRendererService,
} from '@setsuna-desktop/feature-conversation-debug/renderer';
import { imageGenerationRendererAssetsCapability } from '@setsuna-desktop/feature-image-generation/contracts';
import { imageGenerationRendererFeature } from '@setsuna-desktop/feature-image-generation/renderer';
import { goalRendererFeature } from '@setsuna-desktop/feature-goal/renderer';
import { memoryRendererFeature } from '@setsuna-desktop/feature-memory/renderer';
import { threadTitleGenerationRendererFeature } from '@setsuna-desktop/feature-thread-title-generation/renderer';
import { mcpRendererServiceCapability } from '@setsuna-desktop/feature-mcp/contracts';
import { mcpRendererFeature } from '@setsuna-desktop/feature-mcp/renderer';
import {
  modelProviderRendererFeature,
  modelProviderRendererHostCapability,
  modelProviderRendererStateCapability,
} from '@setsuna-desktop/feature-model-provider/renderer';
import {
  pluginManagementRendererHostCapability,
  pluginManagementRendererServiceCapability,
} from '@setsuna-desktop/feature-plugin-management/contracts';
import { pluginManagementRendererFeature } from '@setsuna-desktop/feature-plugin-management/renderer';
import { reviewRendererServiceCapability } from '@setsuna-desktop/feature-review/contracts';
import { reviewRendererFeature } from '@setsuna-desktop/feature-review/renderer';
import { runtimeActivityRendererServiceCapability } from '@setsuna-desktop/feature-runtime-activity/contracts';
import { runtimeActivityRendererFeature } from '@setsuna-desktop/feature-runtime-activity/renderer';
import {
  createNoopSideConversationRendererService,
  sideConversationRendererHostCapability,
  sideConversationRendererServiceCapability,
} from '@setsuna-desktop/feature-side-conversation/contracts';
import { sideConversationRendererFeature } from '@setsuna-desktop/feature-side-conversation/renderer';
import { skillsRendererServiceCapability } from '@setsuna-desktop/feature-skills/contracts';
import { skillsRendererFeature } from '@setsuna-desktop/feature-skills/renderer';
import {
  networkProxyRendererFeature,
  networkProxyRendererHostCapability,
  networkProxyRendererStateCapability,
} from '@setsuna-desktop/feature-network-proxy/renderer';
import { terminalRendererFeature } from '@setsuna-desktop/feature-terminal/renderer';
import {
  createNoopUsageRendererStateService,
  usageRendererStateCapability,
} from '@setsuna-desktop/feature-usage/contracts';
import {
  usageRendererFeature,
  usageRendererHostCapability,
} from '@setsuna-desktop/feature-usage/renderer';
import {
  updaterRendererFeature,
  updaterRendererHostCapability,
  updaterRendererStateCapability,
} from '@setsuna-desktop/feature-updater/renderer';
import { visionRecognitionRendererFeature } from '@setsuna-desktop/feature-vision-recognition/renderer';
import {
  webDavSyncRendererFeature,
  webDavSyncRendererHostCapability,
} from '@setsuna-desktop/feature-webdav-sync/renderer';
import { workspaceDependenciesRendererFeature } from '@setsuna-desktop/feature-workspace-dependencies/renderer';
import { workspaceAppsRendererFeature } from '@setsuna-desktop/feature-workspace-apps/renderer';
import { appReadySlot } from '@setsuna-desktop/renderer-contracts/shell';
import { chatToolResultResolverSlot } from '@setsuna-desktop/renderer-contracts/chat';
import {
  windowsSandboxRendererFeature,
  windowsSandboxRendererHostCapability,
} from '@setsuna-desktop/feature-windows-sandbox/renderer';
import { createDesktopFeatureOperationTransport } from './desktop-feature-operation-transport.js';
import { createDesktopRuntimeClient } from '../services/runtime-client/client.js';
import { RendererFeatureEventHub } from './renderer-feature-event-hub.js';
import { usageRendererHost } from './UsageFeatureBoundary.js';
import { modelProviderRendererHost } from './ModelProviderFeatureBoundary.js';
import { hostMessages } from '../shared/i18n/messages.js';
import type { AppLocale } from '../shared/i18n/I18nProvider.js';
import {
  createRendererPluginRuntime,
  type RendererPluginRuntime,
} from '../kernel/renderer-plugins/runtime.js';
import { createRendererLayoutPreferenceController } from '../kernel/renderer-plugins/layout-preference-controller.js';
import { createRendererLayoutPreferenceStore } from '../kernel/renderer-plugins/layout-preferences.js';
import { activateBuiltinRendererPlugins } from './builtin-renderer-plugins.js';
import type { BuiltinRendererFeatureServices } from './BuiltinRendererFeatureServicesBoundary.js';
import { activateDeclarativePluginUiGateway } from '../kernel/declarative-plugin-ui/gateway.js';

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
    sideConversationRendererFeature,
    threadTitleGenerationRendererFeature,
    usageRendererFeature,
    visionRecognitionRendererFeature,
    webDavSyncRendererFeature,
    workspaceDependenciesRendererFeature,
  ],
});

export type ActiveRendererFeatures = Readonly<{
  composition: RendererFeatureComposition;
  events: RendererFeatureEventHub;
  messages: ComposedRendererMessages<AppLocale>;
  rendererPlugins: RendererPluginRuntime;
  services: BuiltinRendererFeatureServices;
}>;

export async function activateBuiltinRendererFeatures(): Promise<ActiveRendererFeatures> {
  const runtime = window.setsunaDesktop?.runtime;
  const desktop = window.setsunaDesktop?.desktop;
  if (!runtime || !desktop) throw new Error('Desktop Feature bridge is unavailable.');
  const runtimeClient = createDesktopRuntimeClient();
  const events = new RendererFeatureEventHub();
  const layoutPreferenceStore = createRendererLayoutPreferenceStore(window.localStorage);
  const layoutPreferenceLoad = layoutPreferenceStore.load();
  if (layoutPreferenceLoad.issues.length) {
    console.warn('[RendererPluginRuntime] Ignored invalid saved layout preferences.');
  }
  const rendererPlugins = createRendererPluginRuntime({
    initialPreferences: layoutPreferenceLoad.preferences,
  });
  const layoutPreferences = createRendererLayoutPreferenceController(
    rendererPlugins,
    layoutPreferenceStore,
  );
  const activated = await rendererFeatures.activate({
      createUiRegistrar: (owner, track) => rendererPlugins.createRegistrar(owner, track),
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
        sideConversationRendererHostCapability,
        Object.freeze({
          getThread: (threadId: string) => runtimeClient.getThread(threadId),
          deleteThread: (threadId: string) => runtimeClient.deleteThread(threadId),
        }),
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
    }).catch(async (error: unknown) => {
    await rendererPlugins.dispose();
    throw error;
  });
  const { composition, messages } = activated;
  return completeFeatureHostActivation(composition, async (host) => {
    rendererPlugins.declareRoot(
      Object.freeze({ pluginId: 'core.renderer-kernel', scopeId: 'host:kernel' }),
      Object.freeze({ slot: appReadySlot, required: true }),
    );
    rendererPlugins.declareRoot(
      Object.freeze({ pluginId: 'core.chat-host', scopeId: 'host:chat' }),
      Object.freeze({
        slot: chatToolResultResolverSlot,
        fallback: Object.freeze({ resolve: () => null }),
      }),
    );
    let disposeBuiltinPlugins: Awaited<ReturnType<typeof activateBuiltinRendererPlugins>>;
    try {
      disposeBuiltinPlugins = await activateBuiltinRendererPlugins(rendererPlugins, {
        layoutPreferences,
      });
    } catch (error) {
      await rendererPlugins.dispose();
      throw error;
    }
    host.add(async () => {
      await rendererPlugins.dispose();
      await disposeBuiltinPlugins();
    });
    rendererPlugins.commitInitial();
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
      review: requiredCapability(reviewRendererServiceCapability),
      sideConversation: optionalCapability(
        sideConversationRendererServiceCapability,
        createNoopSideConversationRendererService,
      ),
      skills: requiredCapability(skillsRendererServiceCapability),
      updater: requiredCapability(updaterRendererStateCapability),
      usage: optionalCapability(
        usageRendererStateCapability,
        createNoopUsageRendererStateService,
      ),
    });
    try {
      const disposeDeclarativePluginUi = await activateDeclarativePluginUiGateway(
        rendererPlugins,
        dependencies.pluginManagement,
      );
      host.add(disposeDeclarativePluginUi);
    } catch {
      console.warn('[DeclarativePluginUi] Gateway activation failed; third-party UI was isolated.');
    }
    return Object.freeze({
      composition: host.composition,
      events,
      messages,
      rendererPlugins,
      services: Object.freeze({ ...dependencies }),
    });
  });
}
