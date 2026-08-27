import { defineCapability, type CapabilityToken } from '@setsuna-desktop/feature-core/capability';
import type {
  RuntimeMcpServerInput,
  RuntimeMcpServerList,
  RuntimeMcpServerPatch,
  RuntimeMcpToolList,
} from '@setsuna-desktop/contracts';
import type { McpControl } from './control.js';
import type { McpRuntimeHost } from './control.js';
import type { McpRuntimeToolService } from './runtime-tools.js';

export const mcpControlCapability: CapabilityToken<McpControl> = defineCapability({
  id: 'mcp.control',
  description: 'MCP server configuration, login, and protocol operations',
});

export const mcpRuntimeToolServiceCapability: CapabilityToken<McpRuntimeToolService> = defineCapability({
  id: 'mcp.runtime-tool-service',
  description: 'Agent runtime MCP tools and associated tool host surface',
});

/** Host capability provided by desktop-runtime composition root into the feature. */
export const mcpRuntimeHostCapability: CapabilityToken<McpRuntimeHost> = defineCapability({
  id: 'mcp.runtime-host',
  description: 'MCP store, credentials, network, external URL, and elicitation host facilities',
});

export type McpRendererListener = () => void;

export interface McpRendererService {
  getSnapshot(): RuntimeMcpServerList | null;
  subscribe(listener: McpRendererListener): () => void;
  refresh(options?: Readonly<{ signal?: AbortSignal }>): Promise<RuntimeMcpServerList>;
  discoverTools(
    input: RuntimeMcpServerInput,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<RuntimeMcpToolList>;
  saveServer(
    input: RuntimeMcpServerInput,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<RuntimeMcpServerList>;
  updateServer(
    serverKey: string,
    patch: RuntimeMcpServerPatch,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<RuntimeMcpServerList>;
  deleteServer(
    serverKey: string,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<RuntimeMcpServerList>;
  login(
    serverKey: string,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<RuntimeMcpServerList>;
  logout(
    serverKey: string,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<RuntimeMcpServerList>;
}

export const mcpRendererServiceCapability: CapabilityToken<McpRendererService> = defineCapability({
  id: 'mcp.renderer-service',
  description: 'Renderer state and commands for MCP server management',
});
