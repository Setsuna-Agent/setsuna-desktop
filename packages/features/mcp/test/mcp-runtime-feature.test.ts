import { provideHostCapability, requiredCapability } from '@setsuna-desktop/feature-core/capability';
import {
  defineRuntimeDependencies,
  defineRuntimeFeatureHost,
} from '@setsuna-desktop/feature-core/runtime';
import { describe, expect, it, vi } from 'vitest';
import {
  mcpControlCapability,
  mcpRuntimeHostCapability,
  mcpRuntimeToolServiceCapability,
  type McpRuntimeHost,
} from '../src/contracts/index.js';
import { SdkMcpConnectionManager } from '../src/runtime/adapters/sdk/sdk-mcp-connection-manager.js';
import { mcpRuntimeFeature } from '../src/runtime/feature.js';
import { InMemoryMcpHost, InMemoryMcpStore } from './support/in-memory-mcp-host.js';

describe('mcpRuntimeFeature', () => {
  it('publishes capabilities without connecting and shuts the SDK manager down once', async () => {
    const credentials = new InMemoryMcpHost();
    const fetch = vi.fn(async () => {
      throw new Error('MCP feature setup must not connect.');
    });
    const host: McpRuntimeHost = {
      store: new InMemoryMcpStore(),
      credentials,
      fetch,
      resolveNetworkEnvironment: async () => ({}),
      openExternal: (url) => credentials.openExternal(url),
      elicitation: { request: async () => ({ action: 'decline' }) },
    };
    const shutdown = vi.spyOn(SdkMcpConnectionManager.prototype, 'shutdown');
    const composition = await defineRuntimeFeatureHost({
      required: [mcpRuntimeFeature],
      optional: [],
    }).activate({
      hostCapabilities: [provideHostCapability(mcpRuntimeHostCapability, host)],
    });

    try {
      const dependencies = composition.resolveHostDependencies(defineRuntimeDependencies({
        control: requiredCapability(mcpControlCapability),
        tools: requiredCapability(mcpRuntimeToolServiceCapability),
      }));
      expect(dependencies.control).toBeDefined();
      expect(dependencies.tools).toBeDefined();
      expect(fetch).not.toHaveBeenCalled();

      await composition.dispose();
      await composition.dispose();
      expect(shutdown).toHaveBeenCalledTimes(1);
    } finally {
      await composition.dispose();
      shutdown.mockRestore();
    }
  });
});
