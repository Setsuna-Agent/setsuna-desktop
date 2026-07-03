import path from 'node:path';
import { InMemoryApprovalGate } from '../adapters/approval/in-memory-approval-gate.js';
import { FileConfigStore } from '../adapters/store/file-config-store.js';
import { InMemoryEventBus } from '../adapters/event/in-memory-event-bus.js';
import { FileMemoryStore } from '../adapters/store/file-memory-store.js';
import { FileMcpStore } from '../adapters/store/file-mcp-store.js';
import { JsonThreadStore } from '../adapters/store/json-thread-store.js';
import { FileUsageStore } from '../adapters/store/file-usage-store.js';
import { ConfiguredModelClient } from '../adapters/model/configured-model-client.js';
import { RandomIdGenerator } from '../adapters/id/random-id-generator.js';
import { FileSkillRegistry } from '../adapters/skill/file-skill-registry.js';
import { CompositeToolHost } from '../adapters/tool/composite-tool-host.js';
import { MemoryToolHost } from '../adapters/tool/memory-tool-host.js';
import { McpManagementToolHost } from '../adapters/tool/mcp-management-tool-host.js';
import { McpRuntimeToolHost } from '../adapters/tool/mcp-runtime-tool-host.js';
import { PcLocalToolHost } from '../adapters/tool/pc-local-tool-host.js';
import { SkillManagementToolHost } from '../adapters/tool/skill-management-tool-host.js';
import { FileWorkspaceProjectStore } from '../adapters/workspace/file-workspace-project-store.js';
import { AgentLoop } from '../loop/agent-loop.js';
import { systemClock } from '../ports/clock.js';

export type RuntimeFactoryOptions = {
  dataDir: string;
  builtinSkillsDir?: string;
};

export type RuntimeContainer = ReturnType<typeof createRuntimeFactory>;

/**
 * 为一个桌面数据目录组装 runtime 依赖，把 ports 接到文件存储和内存适配器上。
 *
 * @param options runtime 数据目录和可选内置 skills 目录。
 */
export function createRuntimeFactory(options: RuntimeFactoryOptions) {
  const runtimeDataDir = path.join(options.dataDir, 'runtime');
  const clock = systemClock;
  const ids = new RandomIdGenerator();
  const eventBus = new InMemoryEventBus();
  const approvalGate = new InMemoryApprovalGate(clock, ids);
  // thread/config/usage/MCP/memory 分开落盘，便于后续独立迁移或排查单个数据域。
  const threadStore = new JsonThreadStore(runtimeDataDir, clock, ids);
  const usageStore = new FileUsageStore(runtimeDataDir, ids);
  const mcpStore = new FileMcpStore(runtimeDataDir);
  const configStore = new FileConfigStore(runtimeDataDir);
  // memory 的实际存储根会跟随用户配置变化，因此这里用延迟读取的 storagePath。
  const memoryStore = new FileMemoryStore(runtimeDataDir, clock, ids, async () => (await configStore.getConfig()).storagePath);
  const builtinSkillsDir =
    options.builtinSkillsDir ?? process.env.SETSUNA_DESKTOP_BUILTIN_SKILLS_DIR ?? path.join(process.cwd(), 'skills');
  const skillRegistry = new FileSkillRegistry(builtinSkillsDir, runtimeDataDir);
  const workspaceProjects = new FileWorkspaceProjectStore(runtimeDataDir, clock);
  // ToolHost 顺序会影响模型看到的能力面：先管理能力，再运行 MCP，最后是本地 workspace/memory 工具。
  const toolHost = new CompositeToolHost([
    new McpManagementToolHost(mcpStore),
    new McpRuntimeToolHost(mcpStore),
    new PcLocalToolHost(workspaceProjects),
    new SkillManagementToolHost(skillRegistry),
    new MemoryToolHost(memoryStore, configStore),
  ]);
  const modelClient = new ConfiguredModelClient(configStore);
  const agentLoop = new AgentLoop({
    threadStore,
    modelClient,
    eventBus,
    clock,
    ids,
    approvalGate,
    configStore,
    skillRegistry,
    toolHost,
    usageStore,
    memoryStore,
  });
  // Codex 会在 root session 启动时触发 memories startup；桌面端这里做一次轻量历史抽取。
  const memoryStartup = agentLoop.runMemoryStartupExtraction().catch(() => ({ claimed: 0, extracted: 0 }));

  return {
    agentLoop,
    approvalGate,
    configStore,
    eventBus,
    memoryStore,
    memoryStartup,
    modelClient,
    mcpStore,
    skillRegistry,
    toolHost,
    threadStore,
    usageStore,
    workspaceProjects,
  };
}
