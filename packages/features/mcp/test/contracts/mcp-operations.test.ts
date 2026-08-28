import { describe, expect, it } from 'vitest';
import {
  readMcpServers,
  saveMcpServer,
  updateMcpServer,
} from '../../src/contracts/index.js';

describe('MCP management operation codecs', () => {
  it('normalizes stable server keys while preserving secret-bearing maps', () => {
    expect(saveMcpServer.input.parse({
      command: 'node',
      env: { EMPTY_VALUE: '', TOKEN: 'secret' },
      headers: { Authorization: 'Bearer secret' },
      key: ' _Docs Server_ ',
      transport: 'stdio',
    })).toEqual({
      command: 'node',
      env: { EMPTY_VALUE: '', TOKEN: 'secret' },
      headers: { Authorization: 'Bearer secret' },
      key: 'docs_server',
      transport: 'stdio',
    });

    expect(updateMcpServer.input.parse({
      patch: { enabled: false },
      serverKey: ' _Docs Server_ ',
    })).toEqual({
      patch: { enabled: false },
      serverKey: 'docs_server',
    });
  });

  it('rejects malformed renderer snapshots instead of accepting partial server state', () => {
    expect(() => readMcpServers.output.parse({
      configPath: '/tmp/mcp.json',
      errors: [],
      servers: [{ key: 'missing-required-fields' }],
      workspaceConfigPaths: [],
    })).toThrow();
  });

  it('preserves OAuth configuration in renderer snapshots', () => {
    const result = readMcpServers.output.parse({
      configPath: '/tmp/mcp.json',
      errors: [],
      servers: [{
        allowedTools: [],
        args: [],
        disabledTools: [],
        enabled: true,
        envKeys: [],
        headerKeys: [],
        key: 'oauth-server',
        label: 'OAuth server',
        oauthClientId: 'desktop-client',
        oauthResource: 'https://resource.example.com',
        readOnly: false,
        source: 'local',
        startupTimeoutMs: 120_000,
        timeoutMs: 120_000,
        toolTimeoutMs: 120_000,
        tools: [],
        transport: 'streamableHttp',
        url: 'https://mcp.example.com',
      }],
      workspaceConfigPaths: [],
    });

    expect(result.servers[0]).toMatchObject({
      oauthClientId: 'desktop-client',
      oauthResource: 'https://resource.example.com',
    });
  });
});
