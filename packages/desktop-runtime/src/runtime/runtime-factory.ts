import path from 'node:path';
import { InMemoryApprovalGate } from '../adapters/approval/in-memory-approval-gate.js';
import { FileConfigStore } from '../adapters/store/file-config-store.js';
import { FileAttachmentStore } from '../adapters/store/file-attachment-store.js';
import { FileGeneratedImageStore } from '../adapters/store/file-generated-image-store.js';
import { InMemoryAppServerNotificationBus } from '../adapters/event/in-memory-app-server-notification-bus.js';
import { InMemoryEventBus } from '../adapters/event/in-memory-event-bus.js';
import { FileMemoryStore } from '../adapters/store/file-memory-store.js';
import { FileMcpStore } from '../adapters/store/file-mcp-store.js';
import { FilePersistentToolApprovalStore } from '../adapters/store/file-persistent-tool-approval-store.js';
import { FilePolicyAmendmentStore } from '../adapters/store/file-policy-amendment-store.js';
import { JsonThreadStore } from '../adapters/store/json-thread-store.js';
import { FileUsageStore } from '../adapters/store/file-usage-store.js';
import { SdkMcpConnectionManager } from '../adapters/mcp/sdk-mcp-connection-manager.js';
import { McpElicitationCoordinator } from '../adapters/mcp/mcp-elicitation-coordinator.js';
import { FilePluginBundleStore } from '../adapters/plugin/file-plugin-bundle-store.js';
import { FilePluginMarketplace } from '../adapters/plugin/file-plugin-marketplace.js';
import { HttpBrowserControlClient } from '../adapters/browser/http-browser-control-client.js';
import { HttpDesktopNativeBridge } from '../adapters/native/http-desktop-native-bridge.js';
import { ConfiguredModelClient } from '../adapters/model/configured-model-client.js';
import { ImageAssetResolvingModelClient } from '../adapters/model/image-asset-resolving-model-client.js';
import { RandomIdGenerator } from '../adapters/id/random-id-generator.js';
import { FileSkillRegistry } from '../adapters/skill/file-skill-registry.js';
import { SkillMcpDependencyCoordinator } from '../adapters/skill/skill-mcp-dependency-coordinator.js';
import { CompositeToolHost } from '../adapters/tool/composite-tool-host.js';
import { ArtifactToolHost } from '../adapters/tool/artifact-tool-host.js';
import { BrowserToolHost } from '../adapters/tool/browser-tool-host.js';
import { MemoryToolHost } from '../adapters/tool/memory-tool-host.js';
import { McpManagementToolHost } from '../adapters/tool/mcp-management-tool-host.js';
import { McpRuntimeToolHost } from '../adapters/tool/mcp-runtime-tool-host.js';
import { OpenAiImageGenerationToolHost } from '../adapters/tool/openai-image-generation-tool-host.js';
import { PcLocalToolHost } from '../adapters/tool/pc-local-tool-host.js';
import { PluginBundleToolHost } from '../adapters/tool/plugin-bundle-tool-host.js';
import { SkillManagementToolHost } from '../adapters/tool/skill-management-tool-host.js';
import { UserInputToolHost } from '../adapters/tool/user-input-tool-host.js';
import { WorkspaceImageToolHost } from '../adapters/tool/workspace-image-tool-host.js';
import { FileWorkspaceProjectStore } from '../adapters/workspace/file-workspace-project-store.js';
import { FileProjectInstructionLoader } from '../adapters/workspace/file-project-instruction-loader.js';
import { FileProjectWorkflowResolver } from '../adapters/workspace/file-project-workflow-resolver.js';
import { WorkspaceRuntimeEnvironmentResolver } from '../adapters/workspace/workspace-runtime-environment-resolver.js';
import { ManagedWorkspaceDependencyManager } from '../adapters/workspace/managed-workspace-dependency-manager.js';
import { AgentLoop } from '../loop/agent-loop.js';
import { RuntimeEventWriter } from '../loop/runtime-event-writer.js';
import { systemClock } from '../ports/clock.js';
import type { DesktopNativeBridge } from '../ports/secret-store.js';
import { EventCoordinatedThreadStore } from './event-coordinated-thread-store.js';

export type RuntimeFactoryOptions = {
  dataDir: string;
  builtinSkillsDir?: string;
  builtinPluginsDir?: string;
  nativeBridge?: DesktopNativeBridge;
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
  const appServerNotificationBus = new InMemoryAppServerNotificationBus();
  const approvalGate = new InMemoryApprovalGate(clock, ids);
  // thread/config/usage/MCP/memory 分开落盘，便于后续独立迁移或排查单个数据域。
  const persistedThreadStore = new JsonThreadStore(runtimeDataDir, clock, ids);
  const attachmentStore = new FileAttachmentStore(runtimeDataDir, clock, ids);
  const generatedImageStore = new FileGeneratedImageStore(runtimeDataDir, ids);
  const eventWriter = new RuntimeEventWriter(persistedThreadStore, eventBus);
  const threadStore = new EventCoordinatedThreadStore(persistedThreadStore, eventWriter, generatedImageStore);
  const configStore = new FileConfigStore(runtimeDataDir);
  const nativeBridge = options.nativeBridge ?? HttpDesktopNativeBridge.fromEnvironment();
  const usageStore = new FileUsageStore(runtimeDataDir, ids, async () => (await configStore.getConfig()).providers);
  const mcpStore = new FileMcpStore(runtimeDataDir, nativeBridge);
  const mcpElicitations = new McpElicitationCoordinator(approvalGate, eventWriter, clock, ids);
  const mcpConnections = new SdkMcpConnectionManager({ nativeBridge, elicitationCoordinator: mcpElicitations });
  const policyAmendmentStore = new FilePolicyAmendmentStore(runtimeDataDir);
  const persistentToolApprovalStore = new FilePersistentToolApprovalStore(runtimeDataDir, mcpStore);
  // memory 的实际存储根会跟随用户配置变化，因此这里用延迟读取的 storagePath。
  const memoryStore = new FileMemoryStore(runtimeDataDir, clock, ids, async () => (await configStore.getConfig()).storagePath);
  const builtinSkillsDir =
    options.builtinSkillsDir ?? process.env.SETSUNA_DESKTOP_BUILTIN_SKILLS_DIR ?? path.join(process.cwd(), 'skills');
  const fileSkillRegistry = new FileSkillRegistry(builtinSkillsDir, runtimeDataDir);
  const skillRegistry = new SkillMcpDependencyCoordinator(fileSkillRegistry, mcpStore, mcpConnections);
  const pluginStore = new FilePluginBundleStore(runtimeDataDir, fileSkillRegistry, mcpStore, mcpConnections, configStore, clock);
  const builtinPluginsDir =
    options.builtinPluginsDir ?? process.env.SETSUNA_DESKTOP_BUILTIN_PLUGINS_DIR ?? path.join(process.cwd(), 'plugins');
  const pluginMarketplace = new FilePluginMarketplace(builtinPluginsDir, pluginStore);
  const workspaceProjects = new FileWorkspaceProjectStore(runtimeDataDir, clock);
  const workspaceDependencies = new ManagedWorkspaceDependencyManager(runtimeDataDir, configStore);
  const environmentResolver = new WorkspaceRuntimeEnvironmentResolver(workspaceProjects);
  const projectInstructions = new FileProjectInstructionLoader();
  const projectWorkflow = new FileProjectWorkflowResolver();
  const browserControl = HttpBrowserControlClient.fromEnvironment();
  // ToolHost 顺序会影响模型看到的能力面：先管理能力，再运行 MCP，最后是本地 workspace/memory 工具。
  const toolHost = new CompositeToolHost([
    new UserInputToolHost(approvalGate, eventWriter, clock, ids),
    new BrowserToolHost(browserControl),
    new McpManagementToolHost(mcpStore, mcpConnections),
    new McpRuntimeToolHost(mcpStore, mcpConnections),
    new PluginBundleToolHost(pluginStore),
    new OpenAiImageGenerationToolHost(configStore, pluginStore, generatedImageStore, { threadStore, workspaceProjects }),
    new WorkspaceImageToolHost(workspaceProjects),
    new ArtifactToolHost(workspaceProjects),
    new PcLocalToolHost(workspaceProjects, policyAmendmentStore, workspaceDependencies),
    new SkillManagementToolHost(skillRegistry, skillRegistry),
    new MemoryToolHost(memoryStore, configStore),
  ]);
  const modelClient = new ImageAssetResolvingModelClient(
    new ConfiguredModelClient(configStore),
    generatedImageStore,
  );
  const agentLoop = new AgentLoop({
    attachmentStore,
    threadStore,
    modelClient,
    eventBus,
    environmentResolver,
    clock,
    ids,
    imageStore: generatedImageStore,
    approvalGate,
    appServerNotificationBus,
    configStore,
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
  });
  return {
    agentLoop,
    attachmentStore,
    approvalGate,
    appServerNotificationBus,
    configStore,
    eventBus,
    eventWriter,
    environmentResolver,
    generatedImageStore,
    memoryStore,
    modelClient,
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
    threadStore,
    usageStore,
    workspaceDependencies,
    workspaceProjects,
  };
}
