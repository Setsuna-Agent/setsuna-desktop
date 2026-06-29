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
};

export type RuntimeContainer = ReturnType<typeof createRuntimeFactory>;

export function createRuntimeFactory(options: RuntimeFactoryOptions) {
  const runtimeDataDir = path.join(options.dataDir, 'runtime');
  const clock = systemClock;
  const ids = new RandomIdGenerator();
  const eventBus = new InMemoryEventBus();
  const approvalGate = new InMemoryApprovalGate(clock, ids);
  const threadStore = new JsonThreadStore(runtimeDataDir, clock, ids);
  const usageStore = new FileUsageStore(runtimeDataDir, ids);
  const mcpStore = new FileMcpStore(runtimeDataDir);
  const configStore = new FileConfigStore(runtimeDataDir);
  const memoryStore = new FileMemoryStore(runtimeDataDir, clock, ids, async () => (await configStore.getConfig()).storagePath);
  const skillRegistry = new FileSkillRegistry(path.join(process.cwd(), 'skills'), runtimeDataDir);
  const workspaceProjects = new FileWorkspaceProjectStore(runtimeDataDir, clock);
  const toolHost = new CompositeToolHost([
    new McpManagementToolHost(mcpStore),
    new McpRuntimeToolHost(mcpStore),
    new PcLocalToolHost(workspaceProjects),
    new SkillManagementToolHost(skillRegistry),
    new MemoryToolHost(memoryStore),
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

  return {
    agentLoop,
    approvalGate,
    configStore,
    eventBus,
    memoryStore,
    mcpStore,
    skillRegistry,
    toolHost,
    threadStore,
    usageStore,
    workspaceProjects,
  };
}
