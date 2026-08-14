import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileMcpStore } from '../../../src/adapters/store/file-mcp-store.js';
import { InMemorySecretStore } from '../../support/in-memory-secret-store.js';

describe('file mcp store', () => {
  it('serializes concurrent server upserts without losing either server', async () => {
    const store = new FileMcpStore(await mkdtemp(path.join(tmpdir(), 'setsuna-mcp-store-test-')), new InMemorySecretStore());

    await Promise.all([
      store.upsertServer({ key: 'alpha', transport: 'stdio', command: 'alpha-server' }),
      store.upsertServer({ key: 'beta', transport: 'stdio', command: 'beta-server' }),
    ]);

    expect((await store.listServers()).servers.map((server) => server.key).sort()).toEqual(['alpha', 'beta']);
  });

  it('stores local MCP servers and only exposes secret key names', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-mcp-store-test-'));
    const store = new FileMcpStore(dataDir, new InMemorySecretStore());

    const saved = await store.upsertServer({
      key: 'Docs MCP',
      label: 'Docs',
      transport: 'stdio',
      command: 'node',
      args: ['server.js'],
      env: { DOCS_TOKEN: 'secret-token' },
    });

    expect(saved.servers).toMatchObject([
      {
        key: 'docs_mcp',
        label: 'Docs',
        transport: 'stdio',
        command: 'node',
        args: ['server.js'],
        envKeys: ['DOCS_TOKEN'],
        readOnly: false,
      },
    ]);
    expect(JSON.stringify(saved)).not.toContain('secret-token');

    const raw = await readFile(path.join(dataDir, 'mcp.json'), 'utf8');
    expect(raw).not.toContain('secret-token');
    expect(raw).toContain('env_credential_refs');
    expect(JSON.parse(raw)).toHaveProperty('mcp_servers.docs_mcp');
    if (process.platform !== 'win32') {
      expect((await stat(path.join(dataDir, 'mcp.json'))).mode & 0o777).toBe(0o600);
    }
  });

  it('updates and deletes HTTP MCP servers', async () => {
    const store = new FileMcpStore(await mkdtemp(path.join(tmpdir(), 'setsuna-mcp-store-test-')), new InMemorySecretStore());

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
          title: 'Search',
          inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
          outputSchema: { type: 'object', properties: { results: { type: 'array' } } },
          annotations: { readOnlyHint: true },
          execution: { taskSupport: 'forbidden' },
          _meta: { ui: 'compact' },
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
          title: 'Search',
          inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
          outputSchema: { type: 'object', properties: { results: { type: 'array' } } },
          annotations: { readOnlyHint: true },
          execution: { taskSupport: 'forbidden' },
          _meta: { ui: 'compact' },
        },
      ],
    });
    expect(JSON.stringify(updated)).not.toContain('Bearer token');
    const raw = JSON.parse(await readFile(store.configPath, 'utf8')) as {
      mcp_servers?: Record<string, { oauth?: { client_id?: string }; oauth_resource?: string }>;
    };
    expect(raw.mcp_servers?.remote.oauth?.client_id).toBe('client-123');
    expect(raw.mcp_servers?.remote.oauth_resource).toBe('https://resource.example.com');
    expect(JSON.stringify(raw)).not.toContain('Bearer token');
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
    const store = new FileMcpStore(dataDir, new InMemorySecretStore());
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
    const store = new FileMcpStore(dataDir, new InMemorySecretStore());
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

  it('migrates legacy inline env and HTTP headers into credential references', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-mcp-store-test-'));
    const secrets = new InMemorySecretStore();
    const store = new FileMcpStore(dataDir, secrets);
    await writeFile(path.join(dataDir, 'mcp.json'), JSON.stringify({
      mcp_servers: {
        remote: {
          url: 'https://example.com/mcp',
          headers: { Authorization: 'Bearer legacy-secret' },
        },
        local: {
          command: 'node',
          env: { API_TOKEN: 'legacy-token' },
        },
      },
    }));

    await store.migrateLegacySecrets();

    const raw = await readFile(store.configPath, 'utf8');
    expect(raw).not.toContain('legacy-secret');
    expect(raw).not.toContain('legacy-token');
    expect(raw).toContain('http_header_credential_refs');
    expect(raw).toContain('env_credential_refs');
    await expect(store.listServerInputs()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'remote', headers: { Authorization: 'Bearer legacy-secret' } }),
      expect.objectContaining({ key: 'local', env: { API_TOKEN: 'legacy-token' } }),
    ]));
  });

  it('reads and writes codex-compatible MCP server fields', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-mcp-store-test-'));
    const store = new FileMcpStore(dataDir, new InMemorySecretStore());
    await writeFile(path.join(dataDir, 'mcp.json'), JSON.stringify({
      mcp_servers: {
        docs: {
          command: 'node',
          args: ['server.js'],
          startup_timeout_sec: 2.5,
          tool_timeout_sec: 5,
          enabled_tools: ['search'],
          disabled_tools: ['delete'],
          tools: {
            search: { description: 'Search documents' },
            write_note: { description: 'Write a note' },
          },
        },
      },
    }));

    await expect(store.listServers()).resolves.toMatchObject({
      servers: [{
        key: 'docs',
        startupTimeoutMs: 2500,
        toolTimeoutMs: 5000,
        allowedTools: ['search'],
        disabledTools: ['delete'],
        tools: [
          { name: 'search', description: 'Search documents' },
          { name: 'write_note', description: 'Write a note' },
        ],
      }],
    });
  });
});
