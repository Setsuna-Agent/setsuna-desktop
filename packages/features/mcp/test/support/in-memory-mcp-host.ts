import type {
  McpCredentialStore,
  McpStore,
} from '../../src/contracts/index.js';
import type {
  RuntimeMcpServerInput,
  RuntimeMcpServerList,
  RuntimeMcpServerPatch,
} from '@setsuna-desktop/contracts';

export class InMemoryMcpHost implements McpCredentialStore {
  readonly openedUrls: string[] = [];
  private readonly values = new Map<string, string>();

  async status() {
    return { available: true, backend: 'memory' };
  }

  async get(key: string): Promise<string | undefined> {
    return this.values.get(key);
  }

  async set(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }

  async openExternal(url: string): Promise<void> {
    this.openedUrls.push(url);
  }
}

export class InMemoryMcpStore implements McpStore {
  private readonly servers = new Map<string, RuntimeMcpServerInput>();

  constructor(inputs: RuntimeMcpServerInput[] = []) {
    for (const input of inputs) this.servers.set(input.key, structuredClone(input));
  }

  async listServers(): Promise<RuntimeMcpServerList> {
    return {
      configPath: '/tmp/test-mcp.json',
      workspaceConfigPaths: [],
      errors: [],
      servers: [...this.servers.values()].map((server) => ({
        key: server.key,
        label: server.label ?? server.key,
        description: server.description,
        transport: server.transport ?? (server.command ? 'stdio' : 'streamableHttp'),
        command: server.command,
        args: server.args ?? [],
        cwd: server.cwd,
        url: server.url,
        timeoutMs: server.timeoutMs ?? 120_000,
        startupTimeoutMs: server.startupTimeoutMs ?? server.timeoutMs ?? 120_000,
        toolTimeoutMs: server.toolTimeoutMs ?? server.timeoutMs ?? 120_000,
        enabled: server.enabled !== false,
        allowedTools: server.allowedTools ?? [],
        disabledTools: server.disabledTools ?? [],
        oauthClientId: server.oauthClientId,
        oauthResource: server.oauthResource,
        tools: server.tools ?? [],
        envKeys: Object.keys(server.env ?? {}).sort(),
        headerKeys: [
          ...Object.keys(server.headers ?? {}),
          ...Object.keys(server.envHttpHeaders ?? {}),
          ...(server.bearerTokenEnvVar ? ['Authorization'] : []),
        ].filter((value, index, values) => values.indexOf(value) === index).sort(),
        source: 'local' as const,
        sourcePath: '/tmp/test-mcp.json',
        readOnly: false,
      })),
    };
  }

  async listServerInputs(): Promise<RuntimeMcpServerInput[]> {
    return [...this.servers.values()].map((server) => structuredClone(server));
  }

  async upsertServer(input: RuntimeMcpServerInput): Promise<RuntimeMcpServerList> {
    const previous = this.servers.get(input.key);
    this.servers.set(input.key, {
      ...previous,
      ...structuredClone(input),
    });
    return this.listServers();
  }

  async updateServer(key: string, patch: RuntimeMcpServerPatch): Promise<RuntimeMcpServerList> {
    const previous = this.servers.get(key);
    if (!previous) throw new Error(`MCP server not found: ${key}`);
    this.servers.set(key, { ...previous, ...structuredClone(patch), key });
    return this.listServers();
  }

  async deleteServer(key: string): Promise<void> {
    this.servers.delete(key);
  }
}
