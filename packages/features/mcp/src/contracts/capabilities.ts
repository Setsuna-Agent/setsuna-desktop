import { defineCapability, type CapabilityToken } from '@setsuna-desktop/feature-core/capability';
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
