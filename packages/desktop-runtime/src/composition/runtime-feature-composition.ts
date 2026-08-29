import {
  completeFeatureHostActivation,
  defineRuntimeFeatureHost,
  runtimeFeatureSettingsRegistryCapability,
  runtimeRouteRegistrarCapability,
  threadEventReaderCapability,
  type RuntimeFeatureComposition,
} from '@setsuna-desktop/feature-core/runtime';
import {
  optionalCapability,
  provideHostCapability,
  requiredCapability,
} from '@setsuna-desktop/feature-core/capability';
import {
  approvalReviewControlCapability,
  approvalReviewLegacySettingsCapability,
  approvalReviewRuntimeHostCapability,
  createNoopApprovalReviewControl,
} from '@setsuna-desktop/feature-approval-review/contracts';
import { approvalReviewRuntimeFeature } from '@setsuna-desktop/feature-approval-review/runtime';
import {
  artifactRuntimeToolServiceCapability,
  artifactWorkspaceFilesCapability,
} from '@setsuna-desktop/feature-artifact/contracts';
import { artifactRuntimeFeature } from '@setsuna-desktop/feature-artifact/runtime';
import { browserRuntimeToolServiceCapability } from '@setsuna-desktop/feature-browser/contracts';
import { browserRuntimeFeature } from '@setsuna-desktop/feature-browser/runtime';
import {
  conversationDebugControlCapability,
  conversationDebugLegacySettingsCapability,
  conversationDebugRuntimeHostCapability,
  createNoopConversationDebugControl,
} from '@setsuna-desktop/feature-conversation-debug/contracts';
import { conversationDebugRuntimeFeature } from '@setsuna-desktop/feature-conversation-debug/runtime';
import {
  mcpControlCapability,
  mcpRuntimeHostCapability,
  mcpRuntimeToolServiceCapability,
  type McpRuntimeHost,
} from '@setsuna-desktop/feature-mcp/contracts';
import { mcpRuntimeFeature } from '@setsuna-desktop/feature-mcp/runtime';
import {
  collaborationControlCapability,
  collaborationRuntimeHostCapability,
  createNoopCollaborationControl,
} from '@setsuna-desktop/feature-collaboration/contracts';
import { collaborationRuntimeFeature } from '@setsuna-desktop/feature-collaboration/runtime';
import {
  imageGenerationAssetStoreCapability,
  imageGenerationFeature,
  imageGenerationLegacySettingsCapability,
  imageGenerationNetworkCapability,
  imageGenerationReferenceReaderCapability,
  imageGenerationServiceCapability,
  imageGenerationWorkspaceFilesCapability,
} from '@setsuna-desktop/feature-image-generation/contracts';
import { imageGenerationRuntimeFeature } from '@setsuna-desktop/feature-image-generation/runtime';
import {
  createNoopGoalControl,
  goalControlCapability,
  goalRuntimeHostCapability,
} from '@setsuna-desktop/feature-goal/contracts';
import { goalRuntimeFeature } from '@setsuna-desktop/feature-goal/runtime';
import {
  createNoopMemoryControl,
  memoryControlCapability,
  memoryLegacySettingsCapability,
  memoryRuntimeHostCapability,
} from '@setsuna-desktop/feature-memory/contracts';
import { memoryRuntimeFeature } from '@setsuna-desktop/feature-memory/runtime';
import {
  createNoopThreadTitleGenerationControl,
  threadTitleGenerationControlCapability,
  threadTitleGenerationLegacySettingsCapability,
  threadTitleGenerationRuntimeHostCapability,
} from '@setsuna-desktop/feature-thread-title-generation/contracts';
import { threadTitleGenerationRuntimeFeature } from '@setsuna-desktop/feature-thread-title-generation/runtime';
import {
  modelProviderRuntimeHostCapability,
  modelProviderSamplingCapability,
  type ModelProviderRuntimeHost,
} from '@setsuna-desktop/feature-model-provider/contracts';
import { modelProviderRuntimeFeature } from '@setsuna-desktop/feature-model-provider/runtime';
import {
  pluginManagementRuntimeHostCapability,
  type PluginManagementRuntimeHost,
} from '@setsuna-desktop/feature-plugin-management/contracts';
import { pluginManagementRuntimeFeature } from '@setsuna-desktop/feature-plugin-management/runtime';
import {
  reviewControlCapability,
  reviewLegacySettingsCapability,
  reviewRuntimeHostCapability,
} from '@setsuna-desktop/feature-review/contracts';
import { reviewRuntimeFeature } from '@setsuna-desktop/feature-review/runtime';
import { runtimeActivityRuntimeHostCapability } from '@setsuna-desktop/feature-runtime-activity/contracts';
import { runtimeActivityRuntimeFeature } from '@setsuna-desktop/feature-runtime-activity/runtime';
import { sideConversationRuntimeHostCapability } from '@setsuna-desktop/feature-side-conversation/contracts';
import { sideConversationRuntimeFeature } from '@setsuna-desktop/feature-side-conversation/runtime';
import {
  skillsRuntimeHostCapability,
  type SkillsRuntimeHost,
} from '@setsuna-desktop/feature-skills/contracts';
import { skillsRuntimeFeature } from '@setsuna-desktop/feature-skills/runtime';
import {
  createNoopUsageControl,
  usageControlCapability,
  usageRuntimeHostCapability,
} from '@setsuna-desktop/feature-usage/contracts';
import { usageRuntimeFeature } from '@setsuna-desktop/feature-usage/runtime';
import {
  visionRecognitionFeature,
  visionRecognitionRuntimeHostCapability,
  visionRecognitionServiceCapability,
} from '@setsuna-desktop/feature-vision-recognition/contracts';
import { visionRecognitionRuntimeFeature } from '@setsuna-desktop/feature-vision-recognition/runtime';
import {
  workspaceDependenciesControlCapability,
  workspaceDependenciesFeature,
  workspaceDependenciesLegacySettingsCapability,
  workspaceDependenciesRuntimeHostCapability,
} from '@setsuna-desktop/feature-workspace-dependencies/contracts';
import { workspaceDependenciesRuntimeFeature } from '@setsuna-desktop/feature-workspace-dependencies/runtime';
import { windowsSandboxRuntimeServiceCapability } from '@setsuna-desktop/feature-windows-sandbox/contracts';
import { windowsSandboxRuntimeFeature } from '@setsuna-desktop/feature-windows-sandbox/runtime';
import { createRuntimeApprovalReviewHost } from '../loop/core/runtime-approval-review-host.js';
import { appendRuntimeDebugTraceSafely } from '../ports/runtime-debug-trace.js';
import type { RuntimeContainer } from '../runtime/runtime-factory.js';
import { createSideConversationRuntimeHost } from './side-conversation-runtime-host.js';

const runtimeFeatures = defineRuntimeFeatureHost({
  required: [
    artifactRuntimeFeature,
    browserRuntimeFeature,
    modelProviderRuntimeFeature,
    pluginManagementRuntimeFeature,
    reviewRuntimeFeature,
    runtimeActivityRuntimeFeature,
    skillsRuntimeFeature,
    windowsSandboxRuntimeFeature,
    mcpRuntimeFeature,
  ],
  optional: [
    approvalReviewRuntimeFeature,
    collaborationRuntimeFeature,
    conversationDebugRuntimeFeature,
    imageGenerationRuntimeFeature,
    goalRuntimeFeature,
    memoryRuntimeFeature,
    sideConversationRuntimeFeature,
    threadTitleGenerationRuntimeFeature,
    usageRuntimeFeature,
    visionRecognitionRuntimeFeature,
    workspaceDependenciesRuntimeFeature,
  ],
});

export async function activateBuiltinRuntimeFeatures(
  runtime: RuntimeContainer,
): Promise<RuntimeFeatureComposition> {
  const composition = await runtimeFeatures.activate({
    settingsRegistry: runtime.featureSettings,
    hostCapabilities: [
      provideHostCapability(runtimeRouteRegistrarCapability, runtime.featureRoutes),
      provideHostCapability(
        approvalReviewRuntimeHostCapability,
        createRuntimeApprovalReviewHost({
          clock: runtime.clock,
          configStore: runtime.configStore,
          modelClient: runtime.modelClient,
          threadStore: runtime.threadStore,
          usageStore: runtime.usageRecorder,
        }),
      ),
      provideHostCapability(
        approvalReviewLegacySettingsCapability,
        runtime.configStore.approvalReviewLegacySettingsAdapter(),
      ),
      provideHostCapability(artifactWorkspaceFilesCapability, runtime.workspaceProjects),
      provideHostCapability(
        modelProviderRuntimeHostCapability,
        Object.freeze({
          resolveProvider: (providerId?: string) => providerId
            ? runtime.configStore.getProviderConfig?.(providerId) ?? Promise.resolve(null)
            : runtime.configStore.getActiveProviderConfig(),
          readProviderState: async () => {
            const config = await runtime.configStore.getConfig();
            return {
              ...(config.activeProviderId ? { activeProviderId: config.activeProviderId } : {}),
              providers: config.providers,
            };
          },
          saveProviderState: async (input) => {
            const config = await runtime.configStore.saveConfig(input);
            return {
              ...(config.activeProviderId ? { activeProviderId: config.activeProviderId } : {}),
              providers: config.providers,
            };
          },
          fetchForRoute: (route) => (
            runtime.networkProxyFetch.forRoute(route) as typeof fetch
          ),
          reportReplayDecisions: (trace) => {
            const spanId = `model-request:${trace.turnId}:${trace.afterEventSeq}`;
            for (const payload of trace.decisions) {
              appendRuntimeDebugTraceSafely(runtime.conversationDebugTraceSink, {
                afterEventSeq: trace.afterEventSeq,
                kind: 'provider.replay.decision',
                payload,
                spanId,
                threadId: trace.threadId,
                turnId: trace.turnId,
              });
            }
          },
        } satisfies ModelProviderRuntimeHost),
      ),
      provideHostCapability(
        threadEventReaderCapability,
        runtime.threadEventReader,
      ),
      provideHostCapability(
        runtimeFeatureSettingsRegistryCapability,
        runtime.featureSettings,
      ),
      provideHostCapability(
        conversationDebugRuntimeHostCapability,
        Object.freeze({
          id: (prefix: string) => runtime.ids.id(prefix),
          now: () => runtime.clock.now(),
          threadExists: async (threadId: string) => Boolean(await runtime.threadStore.getThread(threadId)),
        }),
      ),
      provideHostCapability(
        conversationDebugLegacySettingsCapability,
        runtime.configStore.conversationDebugLegacySettingsAdapter(),
      ),
      provideHostCapability(
        imageGenerationAssetStoreCapability,
        runtime.generatedImageStore,
      ),
      provideHostCapability(
        imageGenerationReferenceReaderCapability,
        runtime.threadStore,
      ),
      provideHostCapability(
        imageGenerationNetworkCapability,
        Object.freeze({ fetch: runtime.networkProxyFetch.forRoute() }),
      ),
      provideHostCapability(
        imageGenerationWorkspaceFilesCapability,
        runtime.workspaceProjects,
      ),
      provideHostCapability(
        imageGenerationLegacySettingsCapability,
        runtime.configStore.imageGenerationLegacySettingsAdapter(),
      ),
      provideHostCapability(
        collaborationRuntimeHostCapability,
        runtime.agentLoop.collaborationRuntimeHost(),
      ),
      provideHostCapability(
        goalRuntimeHostCapability,
        runtime.agentLoop.goalRuntimeHost(),
      ),
      provideHostCapability(
        memoryRuntimeHostCapability,
        runtime.agentLoop.memoryRuntimeHost(),
      ),
      provideHostCapability(
        memoryLegacySettingsCapability,
        runtime.configStore.memoryLegacySettingsAdapter(),
      ),
      provideHostCapability(
        threadTitleGenerationRuntimeHostCapability,
        runtime.agentLoop.threadTitleGenerationRuntimeHost(),
      ),
      provideHostCapability(
        threadTitleGenerationLegacySettingsCapability,
        runtime.configStore.threadTitleGenerationLegacySettingsAdapter(),
      ),
      provideHostCapability(
        pluginManagementRuntimeHostCapability,
        Object.freeze({
          catalogRevision: () => runtime.pluginStore.catalogRevision(),
          getInstalledItem: ({ itemId, kind, pluginId }) => (
            runtime.pluginStore.readItemContent(pluginId, kind, itemId)
          ),
          getMarketplaceItem: ({ itemId, kind, pluginId }) => (
            runtime.pluginMarketplace.readItemContent(pluginId, kind, itemId)
          ),
          installLocal: ({ path }) => runtime.pluginStore.installPlugin({ path }),
          installMarketplace: ({ pluginId }) => runtime.pluginMarketplace.installPlugin(pluginId),
          listExtensions: () => runtime.extensionManager.listStatuses(),
          listHooks: (input) => runtime.hookManagement.list(input),
          listMarketplace: () => runtime.pluginMarketplace.listPlugins(),
          listPlugins: () => runtime.pluginStore.listPlugins(),
          deleteStandaloneHook: (input) => runtime.hookManagement.deleteStandalone(input),
          remove: ({ pluginId }) => runtime.pluginStore.removePlugin(pluginId),
          setHookState: (input) => runtime.hookManagement.setState(input),
          setExtensionTrust: ({ pluginId, trusted }) => (
            runtime.pluginStore.setExtensionTrust(pluginId, trusted)
          ),
          updateMarketplace: ({ pluginId }) => runtime.pluginMarketplace.updatePlugin(pluginId),
        } satisfies PluginManagementRuntimeHost),
      ),
      provideHostCapability(
        reviewRuntimeHostCapability,
        runtime.reviewRuntimeHost,
      ),
      provideHostCapability(
        reviewLegacySettingsCapability,
        runtime.configStore.reviewLegacySettingsAdapter(),
      ),
      provideHostCapability(
        runtimeActivityRuntimeHostCapability,
        Object.freeze({
          activeTurnId: (threadId: string) => runtime.agentLoop.activeTurnId(threadId),
          cancelTurn: (threadId: string, turnId: string) => runtime.agentLoop.cancelTurn(threadId, turnId),
          getTurnActivity: (threadId: string, turnId: string) => (
            runtime.threadStore.getTurnActivity(threadId, turnId)
          ),
          listApprovals: async () => (await runtime.approvalGate.listApprovals()).approvals,
          listBackgroundShellProcesses: (threadId?: string) => threadId
            ? runtime.backgroundShellProcesses.listBackgroundShellProcesses(threadId)
            : runtime.backgroundShellProcesses.listAllBackgroundShellProcesses(),
          listThreads: () => runtime.threadStore.listThreads({
            includeArchived: true,
            includeSide: true,
          }),
          now: () => runtime.clock.now(),
          terminateBackgroundShellProcess: (threadId: string, processId: string) => (
            runtime.backgroundShellProcesses.terminateBackgroundShellProcess(threadId, processId)
          ),
        }),
      ),
      provideHostCapability(
        sideConversationRuntimeHostCapability,
        createSideConversationRuntimeHost(runtime),
      ),
      provideHostCapability(
        skillsRuntimeHostCapability,
        Object.freeze({
          control: runtime.skillRegistry,
          publishChanged: () => {
            runtime.appServerNotificationBus.publish({ method: 'skills/changed', params: {} });
          },
        } satisfies SkillsRuntimeHost),
      ),
      provideHostCapability(
        usageRuntimeHostCapability,
        Object.freeze({
          dataDir: runtime.dataDir,
          id: (prefix: string) => runtime.ids.id(prefix),
          listProviders: async () => (await runtime.configStore.getConfig()).providers.map((provider) => Object.freeze({
            id: provider.id,
            name: provider.name.trim() || provider.id,
            provider: provider.provider,
            baseUrl: provider.baseUrl,
            ...(provider.icon ? { icon: provider.icon } : {}),
            models: Object.freeze(provider.models.map((model) => Object.freeze({
              code: model.code,
              name: model.name,
              ...(model.icon ? { icon: model.icon } : {}),
            }))),
          })),
        }),
      ),
      provideHostCapability(
        visionRecognitionRuntimeHostCapability,
        runtime.visionRecognitionHost,
      ),
      provideHostCapability(
        workspaceDependenciesRuntimeHostCapability,
        Object.freeze({
          dataDir: runtime.dataDir,
          fetch: runtime.networkProxyFetch.forRoute(),
          resolveNetworkEnvironment: () => runtime.networkProxyFetch.environmentForRoute(),
          sandboxNetworkAccessEnabled: async () => (
            (await runtime.configStore.getConfig()).sandboxWorkspaceWrite?.networkAccess === true
          ),
        }),
      ),
      provideHostCapability(
        workspaceDependenciesLegacySettingsCapability,
        runtime.configStore.workspaceDependenciesLegacySettingsAdapter(),
      ),
      provideHostCapability(
        mcpRuntimeHostCapability,
        Object.freeze({
          store: runtime.mcpStore,
          credentials: runtime.nativeBridge,
          fetch: runtime.networkProxyFetch.forRoute(),
          resolveNetworkEnvironment: () => runtime.networkProxyFetch.environmentForRoute(),
          openExternal: (url: string) => runtime.nativeBridge.openExternal(url),
          elicitation: runtime.mcpElicitations,
        } satisfies McpRuntimeHost),
      ),
    ],
  });

  return completeFeatureHostActivation(composition, (host) => {
    host.bind({
      approvalReview: optionalCapability(
        approvalReviewControlCapability,
        createNoopApprovalReviewControl,
      ),
    }, ({ approvalReview }) => runtime.agentLoop.bindApprovalReviewControl(approvalReview));

    host.bind({
      sampling: requiredCapability(modelProviderSamplingCapability),
    }, ({ sampling }) => runtime.providerModelClient.bind(sampling));

    host.bind({
      tools: requiredCapability(artifactRuntimeToolServiceCapability),
    }, ({ tools }) => runtime.artifactToolHost.bind(tools));

    host.bind({
      tools: requiredCapability(browserRuntimeToolServiceCapability),
    }, ({ tools }) => runtime.browserToolHost.bind(tools));

    host.bind({
      collaboration: optionalCapability(collaborationControlCapability, createNoopCollaborationControl),
    }, ({ collaboration }) => runtime.agentLoop.bindCollaborationControl(collaboration));

    host.bind({
      conversationDebug: optionalCapability(
        conversationDebugControlCapability,
        createNoopConversationDebugControl,
      ),
    }, ({ conversationDebug }) => runtime.conversationDebugTraceSink.bind(conversationDebug));

    host.bindWhenFeatureAvailable(imageGenerationFeature.id, {
      imageGeneration: requiredCapability(imageGenerationServiceCapability),
    }, ({ imageGeneration }) => runtime.extensionManager.setImageGenerationService(imageGeneration));

    host.bind({
      goal: optionalCapability(goalControlCapability, createNoopGoalControl),
    }, ({ goal }) => runtime.agentLoop.bindGoalControl(goal));

    host.bind({
      review: requiredCapability(reviewControlCapability),
    }, ({ review }) => runtime.reviewControl.bind(review));

    host.bind({
      usage: optionalCapability(usageControlCapability, createNoopUsageControl),
    }, ({ usage }) => runtime.usageRecorder.bind(usage));

    host.bind(
      { memory: optionalCapability(memoryControlCapability, createNoopMemoryControl) },
      ({ memory }) => runtime.agentLoop.bindMemoryControl(memory),
      ({ memory }) => runtime.memoryToolHost.bind(memory),
    );

    host.bind({
      threadTitleGeneration: optionalCapability(
        threadTitleGenerationControlCapability,
        createNoopThreadTitleGenerationControl,
      ),
    }, ({ threadTitleGeneration }) => (
      runtime.agentLoop.bindThreadTitleGenerationControl(threadTitleGeneration)
    ));

    host.bindWhenFeatureAvailable(visionRecognitionFeature.id, {
      visionRecognition: requiredCapability(visionRecognitionServiceCapability),
    }, ({ visionRecognition }) => runtime.extensionManager.setVisionRecognitionService(visionRecognition));

    host.bind({
      mcpControl: requiredCapability(mcpControlCapability),
    }, ({ mcpControl }) => runtime.mcpControl.bind(mcpControl));

    host.bind({
      mcpTools: requiredCapability(mcpRuntimeToolServiceCapability),
    }, ({ mcpTools }) => runtime.mcpToolHost.bind(mcpTools));

    host.bindWhenFeatureAvailable(workspaceDependenciesFeature.id, {
      workspaceDependencies: requiredCapability(workspaceDependenciesControlCapability),
    }, ({ workspaceDependencies }) => (
      runtime.backgroundShellProcesses.bindWorkspaceDependencies(workspaceDependencies)
    ));

    host.bind({
      windowsSandbox: requiredCapability(windowsSandboxRuntimeServiceCapability),
    }, ({ windowsSandbox }) => runtime.backgroundShellProcesses.bindShellSandboxProvider({
      capability: () => windowsSandbox.capability(),
      controlRoot: () => windowsSandbox.controlRoot(),
      networkEnvironment: () => runtime.networkProxyFetch.environmentForSandboxRoute(),
      prepareEnvironment: (environment) => windowsSandbox.prepareEnvironment(environment),
      writeRequest: ({ command, controlRoot, executionId, plan }) => {
        if (!plan.providerExecutable) {
          throw new Error('Windows sandbox execution plan has no provider executable.');
        }
        return windowsSandbox.writeRequest({
          command,
          controlRoot,
          cwd: plan.cwd,
          deniedGlobRegExpSources: plan.deniedGlobRegExpSources,
          deniedRoots: plan.deniedRoots,
          environment: plan.environment,
          ephemeralWritableRoots: plan.ephemeralWritableRoots ?? [],
          executionId,
          networkAccess: plan.networkAccess,
          permissionProfile: plan.permissionProfile,
          protectedWritableRoots: plan.protectedWritableRoots,
          providerExecutable: plan.providerExecutable,
          readableRoots: plan.readableRoots,
          workspaceRoot: plan.workspaceRoot,
          writableRoots: plan.writableRoots,
        });
      },
    }));

    host.add(runtime.featureManagement.attach(host.composition));
    return host.composition;
  });
}
