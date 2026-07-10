import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileMcpStore } from './file-mcp-store.js';

describe('file mcp store', () => {
  it('serializes concurrent server upserts without losing either server', async () => {
    const store = new FileMcpStore(await mkdtemp(path.join(tmpdir(), 'setsuna-mcp-store-test-')));

    await Promise.all([
      store.upsertServer({ key: 'alpha', transport: 'stdio', command: 'alpha-server' }),
      store.upsertServer({ key: 'beta', transport: 'stdio', command: 'beta-server' }),
    ]);

    expect((await store.listServers()).servers.map((server) => server.key).sort()).toEqual(['alpha', 'beta']);
  });

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
      requireApproval: 'prompt',
    });

    expect(saved.servers).toMatchObject([
      {
        key: 'docs_mcp',
        label: 'Docs',
        transport: 'stdio',
        command: 'node',
        args: ['server.js'],
        envKeys: ['DOCS_TOKEN'],
        requireApproval: 'prompt',
        readOnly: false,
      },
    ]);
    expect(JSON.stringify(saved)).not.toContain('secret-token');

    const raw = await readFile(path.join(dataDir, 'mcp.json'), 'utf8');
    expect(raw).toContain('secret-token');
    expect(JSON.parse(raw)).toHaveProperty('mcp_servers.docs_mcp');
  });

  it('updates and deletes HTTP MCP servers', async () => {
    const store = new FileMcpStore(await mkdtemp(path.join(tmpdir(), 'setsuna-mcp-store-test-')));

    await store.upsertServer({
      key: 'remote',
      label: 'Remote',
      transport: 'streamableHttp',
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer token' },
      oauthClientId: 'client-123',
      oauthResource: 'https://resource.example.com',
      tools: [
        {
          name: 'search_web',
          description: 'Search the web',
          inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
          annotations: { readOnlyHint: true },
          approvalMode: 'prompt',
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
      oauthClientId: 'client-123',
      oauthResource: 'https://resource.example.com',
      toolTimeoutMs: 5000,
      tools: [
        {
          name: 'search_web',
          description: 'Search the web',
          inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
          annotations: { readOnlyHint: true },
          approvalMode: 'prompt',
        },
      ],
    });
    expect(JSON.stringify(updated)).not.toContain('Bearer token');
    const raw = JSON.parse(await readFile(store.configPath, 'utf8')) as {
      mcp_servers?: Record<string, { oauth?: { client_id?: string }; oauth_resource?: string }>;
    };
    expect(raw.mcp_servers?.remote.oauth?.client_id).toBe('client-123');
    expect(raw.mcp_servers?.remote.oauth_resource).toBe('https://resource.example.com');
    await expect(store.listServerInputs()).resolves.toMatchObject([
      {
        key: 'remote',
        headers: { Authorization: 'Bearer token' },
        oauthClientId: 'client-123',
        oauthResource: 'https://resource.example.com',
        tools: [{ name: 'search_web' }],
      },
    ]);

    await store.deleteServer('remote');
    await expect(store.listServers()).resolves.toMatchObject({ servers: [] });
  });

  it('reads codex-compatible HTTP header fields without exposing values', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-mcp-store-test-'));
    const store = new FileMcpStore(dataDir);
    await writeFile(path.join(dataDir, 'mcp.json'), JSON.stringify({
      mcp_servers: {
        remote: {
          url: 'https://example.com/mcp',
          bearer_token_env_var: 'MCP_TOKEN',
          http_headers: {
            'X-Trace': 'trace-id',
          },
          env_http_headers: {
            'X-Account': 'MCP_ACCOUNT',
          },
          oauth: {
            client_id: 'client-456',
          },
          oauth_resource: 'https://resource.example.com',
        },
      },
    }));

    const listed = await store.listServers();
    expect(listed.servers[0]).toMatchObject({
      key: 'remote',
      transport: 'streamableHttp',
      envKeys: ['MCP_ACCOUNT', 'MCP_TOKEN'],
      headerKeys: ['Authorization', 'X-Account', 'X-Trace'],
      oauthClientId: 'client-456',
      oauthResource: 'https://resource.example.com',
    });
    expect(JSON.stringify(listed)).not.toContain('trace-id');
    await expect(store.listServerInputs()).resolves.toMatchObject([
      {
        key: 'remote',
        headers: {
          'X-Trace': 'trace-id',
        },
        envHttpHeaders: {
          'X-Account': 'MCP_ACCOUNT',
        },
        bearerTokenEnvVar: 'MCP_TOKEN',
        oauthClientId: 'client-456',
        oauthResource: 'https://resource.example.com',
      },
    ]);
  });

  it('rejects unsupported inline bearer tokens like codex', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-mcp-store-test-'));
    const store = new FileMcpStore(dataDir);
    await writeFile(path.join(dataDir, 'mcp.json'), JSON.stringify({
      mcp_servers: {
        remote: {
          url: 'https://example.com/mcp',
          bearer_token: 'plain-secret',
        },
      },
    }));

    await expect(store.listServers()).resolves.toMatchObject({
      servers: [],
      errors: [expect.stringContaining('bearer_token_env_var')],
    });
  });

  it('normalizes legacy approval modes to codex modes', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-mcp-store-test-'));
    const store = new FileMcpStore(dataDir);
    await writeFile(path.join(dataDir, 'mcp.json'), JSON.stringify({
      mcpServers: {
        remote: {
          transport: 'streamableHttp',
          url: 'https://example.com/mcp',
          requireApproval: 'on-write',
        },
        legacy_prompt: {
          transport: 'streamableHttp',
          url: 'https://example.com/mcp',
          require_approval: 'always',
        },
        legacy_approve: {
          transport: 'streamableHttp',
          url: 'https://example.com/mcp',
          require_approval: 'never',
        },
      },
    }));

    await expect(store.listServers()).resolves.toMatchObject({
      servers: expect.arrayContaining([
        expect.objectContaining({ key: 'remote', requireApproval: 'auto' }),
        expect.objectContaining({ key: 'legacy_prompt', requireApproval: 'prompt' }),
        expect.objectContaining({ key: 'legacy_approve', requireApproval: 'approve' }),
      ]),
    });
    await store.updateServer('remote', { enabled: false });

    await expect(readFile(path.join(dataDir, 'mcp.json'), 'utf8')).resolves.not.toContain('on-write');
    await expect(store.listServers()).resolves.toMatchObject({
      servers: expect.arrayContaining([
        expect.objectContaining({ key: 'remote', enabled: false, requireApproval: 'auto' }),
      ]),
    });
  });

  it('reads and writes codex-compatible MCP server fields', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-mcp-store-test-'));
    const store = new FileMcpStore(dataDir);
    await writeFile(path.join(dataDir, 'mcp.json'), JSON.stringify({
      mcp_servers: {
        docs: {
          command: 'node',
          args: ['server.js'],
          startup_timeout_sec: 2.5,
          tool_timeout_sec: 5,
          default_tools_approval_mode: 'prompt',
          enabled_tools: ['search'],
          disabled_tools: ['delete'],
          tools: {
            search: { approval_mode: 'approve' },
            write_note: { approval_mode: 'prompt' },
          },
        },
      },
    }));

    await expect(store.listServers()).resolves.toMatchObject({
      servers: [{
        key: 'docs',
        startupTimeoutMs: 2500,
        toolTimeoutMs: 5000,
        requireApproval: 'prompt',
        allowedTools: ['search'],
        disabledTools: ['delete'],
        tools: [
          { name: 'search', approvalMode: 'approve' },
          { name: 'write_note', approvalMode: 'prompt' },
        ],
      }],
    });

    await store.setToolApprovalMode('docs', 'write_note', 'approve');
    const raw = JSON.parse(await readFile(path.join(dataDir, 'mcp.json'), 'utf8')) as {
      mcp_servers?: Record<string, { tools?: Record<string, { approval_mode?: string }> }>;
    };
    expect(raw.mcp_servers?.docs.tools?.write_note?.approval_mode).toBe('approve');
    expect(raw.mcp_servers?.docs.tools?.search?.approval_mode).toBe('approve');
  });

  it('sets per-tool approval modes without dropping tool metadata', async () => {
    const store = new FileMcpStore(await mkdtemp(path.join(tmpdir(), 'setsuna-mcp-store-test-')));
    await store.upsertServer({
      key: 'docs',
      transport: 'streamableHttp',
      url: 'https://example.com/mcp',
      tools: [
        {
          name: 'write_note',
          description: 'Write a note',
          inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
          annotations: { destructiveHint: true },
          approvalMode: 'prompt',
        },
      ],
    });

    const updated = await store.setToolApprovalMode('docs', 'write_note', 'approve');
    expect(updated.servers[0].tools).toMatchObject([
      {
        name: 'write_note',
        description: 'Write a note',
        inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
        annotations: { destructiveHint: true },
        approvalMode: 'approve',
      },
    ]);

    await store.setToolApprovalMode('docs', 'search', 'prompt');
    await expect(store.listServers()).resolves.toMatchObject({
      servers: [{
        key: 'docs',
        tools: expect.arrayContaining([
          expect.objectContaining({ name: 'search', approvalMode: 'prompt' }),
        ]),
      }],
    });
  });
});
