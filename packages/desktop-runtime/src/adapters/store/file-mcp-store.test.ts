import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileMcpStore } from './file-mcp-store.js';

describe('file mcp store', () => {
  it('stores local MCP servers and only exposes secret key names', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-mcp-store-test-'));
    const store = new FileMcpStore(dataDir);

    const saved = await store.upsertServer({
      key: 'Docs MCP',
      label: 'Docs',
      transport: 'stdio',
      command: 'node',
      args: ['server.js'],
      env: { DOCS_TOKEN: 'secret-token' },
      requireApproval: 'always',
    });

    expect(saved.servers).toMatchObject([
      {
        key: 'docs_mcp',
        label: 'Docs',
        transport: 'stdio',
        command: 'node',
        args: ['server.js'],
        envKeys: ['DOCS_TOKEN'],
        requireApproval: 'always',
        readOnly: false,
      },
    ]);
    expect(JSON.stringify(saved)).not.toContain('secret-token');

    const raw = await readFile(path.join(dataDir, 'mcp.json'), 'utf8');
    expect(raw).toContain('secret-token');
  });

  it('updates and deletes HTTP MCP servers', async () => {
    const store = new FileMcpStore(await mkdtemp(path.join(tmpdir(), 'setsuna-mcp-store-test-')));

    await store.upsertServer({
      key: 'remote',
      label: 'Remote',
      transport: 'streamableHttp',
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer token' },
      tools: [
        {
          name: 'search_web',
          description: 'Search the web',
          inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
          annotations: { readOnlyHint: true },
        },
      ],
    });
    const updated = await store.updateServer('remote', { enabled: false, toolTimeoutMs: 5000 });

    expect(updated.servers[0]).toMatchObject({
      key: 'remote',
      enabled: false,
      transport: 'streamableHttp',
      url: 'https://example.com/mcp',
      headerKeys: ['Authorization'],
      toolTimeoutMs: 5000,
      tools: [
        {
          name: 'search_web',
          description: 'Search the web',
          inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
          annotations: { readOnlyHint: true },
        },
      ],
    });
    expect(JSON.stringify(updated)).not.toContain('Bearer token');
    await expect(store.listServerInputs()).resolves.toMatchObject([
      {
        key: 'remote',
        headers: { Authorization: 'Bearer token' },
        tools: [{ name: 'search_web' }],
      },
    ]);

    await store.deleteServer('remote');
    await expect(store.listServers()).resolves.toMatchObject({ servers: [] });
  });

  it('migrates legacy on-write approval to always', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-mcp-store-test-'));
    const store = new FileMcpStore(dataDir);
    await writeFile(path.join(dataDir, 'mcp.json'), JSON.stringify({
      mcpServers: {
        remote: {
          transport: 'streamableHttp',
          url: 'https://example.com/mcp',
          requireApproval: 'on-write',
        },
      },
    }));

    await expect(store.listServers()).resolves.toMatchObject({
      servers: [{ key: 'remote', requireApproval: 'always' }],
    });
    await store.updateServer('remote', { enabled: false });

    await expect(readFile(path.join(dataDir, 'mcp.json'), 'utf8')).resolves.not.toContain('on-write');
    await expect(store.listServers()).resolves.toMatchObject({
      servers: [{ key: 'remote', enabled: false, requireApproval: 'always' }],
    });
  });
});
