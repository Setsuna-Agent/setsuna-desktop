import type { RuntimeMcpServer } from '@setsuna-desktop/contracts';
import { expect, it } from 'vitest';
import { groupMcpServersBySource } from '../../src/renderer/mcpPresentation.js';

it('groups servers by ownership and configuration source without inferring provenance from names or endpoints', () => {
  const local = server('plugin-looking-name', 'local');
  const plugin = { ...server('ordinary-name', 'local'), pluginId: 'test-plugin' };
  const workspace = server('workspace', 'workspace');
  const legacy = server('legacy', 'legacy');
  const builtin = server('builtin', 'builtin');
  const groups = groupMcpServersBySource([local, workspace, plugin, legacy, builtin]);

  expect(groups.map(({ id, servers }) => ({ id, servers }))).toEqual([
    { id: 'local', servers: [local] },
    { id: 'plugin', servers: [plugin] },
    { id: 'workspace', servers: [workspace] },
    { id: 'legacy', servers: [legacy] },
    { id: 'builtin', servers: [builtin] },
  ]);
});

function server(key: string, source: RuntimeMcpServer['source']): RuntimeMcpServer {
  return {
    key, label: 'Same service', source, transport: 'streamableHttp', url: 'https://example.com/mcp',
    args: [], enabled: true, readOnly: false, allowedTools: [], disabledTools: [], tools: [],
    envKeys: [], headerKeys: [], timeoutMs: 120_000, startupTimeoutMs: 120_000, toolTimeoutMs: 120_000,
  };
}
