import path from 'node:path';
import { InMemoryApprovalGate } from '../adapters/approval/in-memory-approval-gate.js';
import { HttpBrowserControlClient } from '../adapters/browser/http-browser-control-client.js';
import { InMemoryRuntimeDebugTraceStore } from '../adapters/debug/in-memory-runtime-debug-trace-store.js';
import { DesktopVisionRecognitionRuntimeHost } from '../adapters/feature/vision-recognition-runtime-host.js';
import { InMemoryAppServerNotificationBus } from '../adapters/event/in-memory-app-server-notification-bus.js';
import { InMemoryEventBus } from '../adapters/event/in-memory-event-bus.js';
import { RandomIdGenerator } from '../adapters/id/random-id-generator.js';
import { McpElicitationCoordinator } from '../adapters/mcp/mcp-elicitation-coordinator.js';
import { SdkMcpConnectionManager } from '../adapters/mcp/sdk-mcp-connection-manager.js';
import { ConfiguredModelClient } from '../adapters/model/configured-model-client.js';
import { ImageAssetResolvingModelClient } from '../adapters/model/image-asset-resolving-model-client.js';
import { HttpDesktopNativeBridge } from '../adapters/native/http-desktop-native-bridge.js';
import { NativeBridgeProxyFetch } from '../adapters/network/native-bridge-proxy-fetch.js';
import { FilePluginBundleStore } from '../adapters/plugin/file-plugin-bundle-store.js';
import { FilePluginDraftStore } from '../adapters/plugin/file-plugin-draft-store.js';
import { FilePluginMarketplace } from '../adapters/plugin/file-plugin-marketplace.js';
import { createWorkspaceSearchEngine } from '../adapters/search/create-workspace-search-engine.js';
import { FileSkillRegistry } from '../adapters/skill/file-skill-registry.js';
import { SkillMcpDependencyCoordinator } from '../adapters/skill/skill-mcp-dependency-coordinator.js';
import { FileAttachmentStore } from '../adapters/store/file-attachment-store.js';
import { FileConfigStore } from '../adapters/store/file-config-store.js';
import { FileGeneratedImageStore } from '../adapters/store/file-generated-image-store.js';
import { FileMcpStore } from '../adapters/store/file-mcp-store.js';
import { FileMemoryStore } from '../adapters/store/file-memory-store.js';
import { FilePersistentToolApprovalStore } from '../adapters/store/file-persistent-tool-approval-store.js';
import { FilePolicyAmendmentStore } from '../adapters/store/file-policy-amendment-store.js';
import { FileToolResultStore } from '../adapters/store/file-tool-result-store.js';
import { FileUsageStore } from '../adapters/store/file-usage-store.js';
import { SqliteThreadStore } from '../adapters/store/sqlite-thread-store.js';
import { ArtifactToolHost } from '../adapters/tool/artifact-tool-host.js';
import { BrowserToolHost } from '../adapters/tool/browser-tool-host.js';
import { CompositeToolHost } from '../adapters/tool/composite-tool-host.js';
import { ExtensionToolHost } from '../adapters/tool/extension-tool-host.js';
import { McpManagementToolHost } from '../adapters/tool/mcp-management-tool-host.js';
import { McpRuntimeToolHost } from '../adapters/tool/mcp-runtime-tool-host.js';
import { MemoryToolHost } from '../adapters/tool/memory-tool-host.js';
import { PcLocalToolHost } from '../adapters/tool/pc-local/pc-local-tool-host.js';
import { PluginBundleToolHost } from '../adapters/tool/plugin-bundle-tool-host.js';
import { SkillManagementToolHost } from '../adapters/tool/skill-management-tool-host.js';
import { UserInputToolHost } from '../adapters/tool/user-input-tool-host.js';
import { WorkspaceImageToolHost } from '../adapters/tool/workspace-image-tool-host.js';
import { FileProjectInstructionLoader } from '../adapters/workspace/file-project-instruction-loader.js';
import { FileProjectWorkflowResolver } from '../adapters/workspace/file-project-workflow-resolver.js';
import { FileWorkspaceProjectStore } from '../adapters/workspace/file-workspace-project-store.js';
import { ManagedWorkspaceDependencyManager } from '../adapters/workspace/managed-workspace-dependency-manager.js';
import { WorkspaceRuntimeEnvironmentResolver } from '../adapters/workspace/workspace-runtime-environment-resolver.js';
import { ExtensionManager } from '../extensions/extension-manager.js';
import { RuntimeRouteRegistry } from '../features/routes/runtime-route-registry.js';
import { FileFeatureSettingsRegistry } from '../features/settings/file-feature-settings-registry.js';
import { RuntimeFeatureManagement } from '../features/management/runtime-feature-management.js';
import { RuntimeFeatureEventRegistry } from '../features/events/runtime-feature-event-registry.js';
import { ThreadStoreEventReader } from '../features/events/thread-store-event-reader.js';
import { ExtensionUiCoordinator } from '../extensions/extension-ui-coordinator.js';
import { FileExtensionStateStore } from '../extensions/file-extension-state-store.js';
import { AgentLoop } from '../loop/core/agent-loop.js';
import { RuntimeEventWriter } from '../loop/lifecycle/runtime-event-writer.js';
import { systemClock } from '../ports/clock.js';
import type { DesktopNativeBridge } from '../ports/secret-store.js';
import { EventCoordinatedThreadStore } from './event-coordinated-thread-store.js';

export type RuntimeFactoryOptions = {
  dataDir: string;
  builtinSkillsDir?: string;
  builtinPluginsDir?: string;
  nativeBridge?: DesktopNativeBridge;
  ripgrepPath?: string;
  requireBundledRipgrep?: boolean;
  /** Overrides used by source-level tests or embedders that do not load the built worker entry. */
  extensionWorkerEntryPath?: string;
  extensionWorkerExecArgv?: string[];
};

export type RuntimeContainer = ReturnType<typeof createRuntimeFactory>;

/**
 * 为一个桌面数据目录组装 runtime 依赖，把 ports 接到文件存储和内存适配器上。
 *
 * @param options runtime 数据目录，以及可选的内置 skills 与精选插件目录。
 */
export function createRuntimeFactory(options: RuntimeFactoryOptions) {
  const runtimeDataDir = path.join(options.dataDir, 'runtime');
  const clock = systemClock;
  const ids = new RandomIdGenerator();
  const eventBus = new InMemoryEventBus();
  const debugTraceStore = new InMemoryRuntimeDebugTraceStore(clock, ids);
  const appServerNotificationBus = new InMemoryAppServerNotificationBus();
  const featureRoutes = new RuntimeRouteRegistry();
  const featureSettings = new FileFeatureSettingsRegistry(runtimeDataDir);
  const featureManagement = new RuntimeFeatureManagement();
  const approvalGate = new InMemoryApprovalGate(clock, ids);
  // thread/config/usage/MCP/memory 分开落盘，便于后续独立迁移或排查单个数据域。
  const persistedThreadStore = new SqliteThreadStore(runtimeDataDir, clock, ids);
  const featureEvents = new RuntimeFeatureEventRegistry();
  const threadEventReader = new ThreadStoreEventReader(persistedThreadStore);
  const attachmentStore = new FileAttachmentStore(runtimeDataDir, clock, ids);
  const generatedImageStore = new FileGeneratedImageStore(runtimeDataDir, ids);
  const toolResultStore = new FileToolResultStore(runtimeDataDir);
  const eventWriter = new RuntimeEventWriter(
    persistedThreadStore,
    eventBus,
    undefined,
    debugTraceStore,
  );
  eventWriter.subscribePersisted((event) => featureEvents.accept(event));
  const threadStore = new EventCoordinatedThreadStore(persistedThreadStore, eventWriter, generatedImageStore);
  const nativeBridge = options.nativeBridge ?? HttpDesktopNativeBridge.fromEnvironment();
  const configStore = new FileConfigStore(runtimeDataDir, {
    validateProxyServerReferences: (proxyServerIds) =>
      nativeBridge.validateNetworkProxyReferences(proxyServerIds),
  });
  const networkProxyFetch = new NativeBridgeProxyFetch(nativeBridge);
  const usageStore = new FileUsageStore(runtimeDataDir, ids, async () => (await configStore.getConfig()).providers);
  const mcpStore = new FileMcpStore(runtimeDataDir, nativeBridge);
  const mcpElicitations = new McpElicitationCoordinator(approvalGate, eventWriter, clock, ids);
  const mcpConnections = new SdkMcpConnectionManager({
    nativeBridge,
    elicitationCoordinator: mcpElicitations,
    fetchImpl: networkProxyFetch.forRoute(),
    resolveNetworkEnvironment: () => networkProxyFetch.environmentForRoute(),
  });
  const policyAmendmentStore = new FilePolicyAmendmentStore(runtimeDataDir);
  const persistentToolApprovalStore = new FilePersistentToolApprovalStore(runtimeDataDir);
  const memoryStore = new FileMemoryStore(runtimeDataDir, clock, ids);
  const builtinSkillsDir =
    options.builtinSkillsDir ?? process.env.SETSUNA_DESKTOP_BUILTIN_SKILLS_DIR ?? path.join(process.cwd(), 'skills');
  const fileSkillRegistry = new FileSkillRegistry(builtinSkillsDir, runtimeDataDir);
  const skillRegistry = new SkillMcpDependencyCoordinator(fileSkillRegistry, mcpStore, mcpConnections);
  const builtinPluginsDir =
    options.builtinPluginsDir ?? process.env.SETSUNA_DESKTOP_BUILTIN_PLUGINS_DIR ?? path.join(process.cwd(), 'plugins');
  const extensionState = new FileExtensionStateStore(runtimeDataDir);
  const pluginStore = new FilePluginBundleStore(
    runtimeDataDir,
    fileSkillRegistry,
    mcpStore,
    mcpConnections,
    configStore,
    clock,
    extensionState,
    builtinPluginsDir,
  );
  const pluginDraftStore = new FilePluginDraftStore(path.join(runtimeDataDir, 'plugin-drafts'));
  const pluginMarketplace = new FilePluginMarketplace(builtinPluginsDir, pluginStore);
  const workspaceSearchEngine = createWorkspaceSearchEngine({
    ripgrepPath: options.ripgrepPath,
    requireBundledRipgrep: options.requireBundledRipgrep,
  });
  const workspaceProjects = new FileWorkspaceProjectStore(runtimeDataDir, clock, { searchEngine: workspaceSearchEngine });
  const workspaceDependencies = new ManagedWorkspaceDependencyManager(runtimeDataDir, configStore, {
    fetchImpl: networkProxyFetch.forRoute(),
    resolveNetworkEnvironment: () => networkProxyFetch.environmentForRoute(),
  });
  const environmentResolver = new WorkspaceRuntimeEnvironmentResolver(workspaceProjects);
  const projectInstructions = new FileProjectInstructionLoader();
  const projectWorkflow = new FileProjectWorkflowResolver();
  const browserControl = HttpBrowserControlClient.fromEnvironment();
  const configuredModelClient = new ConfiguredModelClient(configStore, globalThis.fetch, undefined, {
    debugTrace: debugTraceStore,
    fetchForProvider: (provider) => networkProxyFetch.forRoute(provider.proxyRoute),
  });
  const modelClient = new ImageAssetResolvingModelClient(configuredModelClient, generatedImageStore);
  const visionRecognitionHost = new DesktopVisionRecognitionRuntimeHost({
    attachments: attachmentStore,
    clock,
    config: configStore,
    legacySettings: configStore.visionRecognitionLegacySettingsAdapter(),
    models: configuredModelClient,
    plugins: pluginStore,
    threads: threadStore,
    usage: usageStore,
  });
  const extensionUi = new ExtensionUiCoordinator(approvalGate, eventWriter, clock, ids);
  const extensionManager = new ExtensionManager(pluginStore, extensionState, extensionUi, {
    networkFetch: networkProxyFetch.forRoute(),
    ...(options.extensionWorkerEntryPath ? { workerEntryPath: options.extensionWorkerEntryPath } : {}),
    ...(options.extensionWorkerExecArgv ? { workerExecArgv: options.extensionWorkerExecArgv } : {}),
  });
  pluginStore.setRuntimeMutationCoordinator(extensionManager);
  const backgroundShellProcesses = new PcLocalToolHost(
    workspaceProjects,
    policyAmendmentStore,
    workspaceDependencies,
    workspaceSearchEngine,
    {
      globalPolicyPaths: [
        path.join(runtimeDataDir, 'pc-local-policies', 'legacy-exec-policy.json'),
        path.join(runtimeDataDir, 'pc-local-policies', 'legacy-shell-policy.json'),
      ],
      mcpConfigPath: path.join(runtimeDataDir, 'mcp.json'),
      memoryStorageRoot: path.join(runtimeDataDir, 'memories'),
      resolveShellEnvironment: ({ sandboxNetworkAccess }) => (
        process.platform === 'win32' && sandboxNetworkAccess
          ? networkProxyFetch.environmentForSandboxRoute()
          : networkProxyFetch.environmentForRoute()
      ),
    },
  );
  // ToolHost 顺序会影响模型看到的能力面：先管理能力，再运行 MCP，最后是本地 workspace/memory 工具。
  const toolHost = new CompositeToolHost([
    new UserInputToolHost(approvalGate, eventWriter, clock, ids),
    new BrowserToolHost(browserControl),
    new McpManagementToolHost(mcpStore, mcpConnections),
    new McpRuntimeToolHost(mcpStore, mcpConnections),
    new PluginBundleToolHost(pluginStore, pluginDraftStore),
    new ExtensionToolHost(extensionManager),
    new WorkspaceImageToolHost(workspaceProjects),
    new ArtifactToolHost(workspaceProjects),
    backgroundShellProcesses,
    new SkillManagementToolHost(skillRegistry, skillRegistry),
    new MemoryToolHost(memoryStore, configStore),
  ]);
  const agentLoop = new AgentLoop({
    attachmentStore,
    threadStore,
    modelClient,
    eventBus,
    environmentResolver,
    extensionManager,
    clock,
    ids,
    imageStore: generatedImageStore,
    approvalGate,
    appServerNotificationBus,
    configStore,
    debugTrace: debugTraceStore,
    skillRegistry,
    toolHost,
    usageStore,
    memoryStore,
    mcpStore,
    policyAmendmentStore,
    persistentToolApprovalStore,
    projectInstructions,
    projectWorkflow,
    eventWriter,
    toolResultStore,
  });
  return {
    agentLoop,
    attachmentStore,
    approvalGate,
    appServerNotificationBus,
    backgroundShellProcesses,
    configStore,
    debugTraceStore,
    eventBus,
    eventWriter,
    featureRoutes,
    featureEvents,
    featureSettings,
    featureManagement,
    environmentResolver,
    extensionManager,
    generatedImageStore,
    visionRecognitionHost,
    memoryStore,
    modelClient,
    networkProxyFetch,
    mcpConnections,
    mcpElicitations,
    mcpStore,
    nativeBridge,
    persistentToolApprovalStore,
    policyAmendmentStore,
    pluginStore,
    pluginMarketplace,
    projectWorkflow,
    skillRegistry,
    toolHost,
    toolResultStore,
    threadStore,
    threadEventReader,
    usageStore,
    workspaceDependencies,
    workspaceProjects,
    workspaceSearchEngine,
  };
}
