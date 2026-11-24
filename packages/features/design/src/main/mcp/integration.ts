import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { designMcpClients, type DesignMcpClient, type DesignMcpSettings } from '../../contracts/design-mcp.js';
import { designMcpEntry, designMcpName, updateDesignMcpClient, type DesignMcpStdio } from './client-config.js';
import type { DesignMcpCanvasBroker } from './canvas-broker.js';
import type { DesignMcpLoopback, DesignMcpSource } from './loopback.js';

type IntegrationOptions = {
  directory: string;
  appRoot: string;
  clientFiles: Record<DesignMcpClient, string>;
  executable(): string;
  writeJsonAtomically(file: string, value: unknown): Promise<void>;
  copyText(value: string): void;
};

export class DesignMcpIntegration {
  private readonly grants = new Map<DesignMcpSource, string>();
  private readonly authorized = new Set<DesignMcpSource>();
  private startup?: Promise<void>;
  private server?: Promise<DesignMcpLoopback>;
  private pending: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: IntegrationOptions, private readonly canvas: DesignMcpCanvasBroker) {}

  restore(signal: AbortSignal): Promise<void> {
    // Endpoint files also record opt-in across restarts. No client configs are read until opted in.
    this.startup ??= Promise.all([...designMcpClients, 'manual' as const].map(async (source) => {
      try {
        let file: string;
        if (source === 'manual') {
          const entries = await readdir(this.options.directory, { withFileTypes: true });
          const entry = entries.find((entry) => entry.isFile() && /^manual(?:-[a-f0-9-]{36})?\.json$/u.test(entry.name));
          if (!entry) return;
          file = join(this.options.directory, entry.name);
        } else {
          file = this.endpointFile(source);
          if (!(await lstat(file)).isFile()) return;
        }
        // Keep the grant revocable even if restoring the client configuration or listener fails.
        this.grants.set(source, file);
        signal.throwIfAborted();
        if (source !== 'manual') await this.updateClient(source, true, signal);
        await this.authorize(source, signal);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !signal.aborted) {
          console.warn(`[design-mcp] Could not restore ${source}:`, error);
        }
      }
    })).then(() => undefined);
    return this.startup;
  }

  async settings(signal: AbortSignal): Promise<DesignMcpSettings> {
    await this.restore(signal);
    await this.pending;
    signal.throwIfAborted();
    return this.snapshot();
  }

  setEnabled(client: DesignMcpClient, enabled: boolean, signal: AbortSignal): Promise<DesignMcpSettings> {
    return this.enqueue(signal, async () => {
      if (enabled) {
        const previouslyGranted = this.grants.has(client);
        const previouslyAuthorized = this.authorized.has(client);
        try {
          await this.authorize(client, signal);
          await this.updateClient(client, true, signal);
        } catch (error) {
          if (!previouslyGranted) await this.revoke(client);
          else if (!previouslyAuthorized) await this.deauthorize(client);
          throw error;
        }
      } else {
        // The client may lock or corrupt its config. Revoke access before touching that file.
        await this.revoke(client);
        await this.updateClient(client, false, signal);
      }
      return this.snapshot();
    });
  }

  copyConfig(signal: AbortSignal): Promise<DesignMcpSettings> {
    return this.enqueue(signal, async () => {
      const previouslyGranted = this.grants.has('manual');
      try {
        await this.authorize('manual', signal);
        signal.throwIfAborted();
        const entry = { type: 'stdio', ...this.config('manual') };
        this.options.copyText(JSON.stringify({ mcpServers: { [designMcpName]: entry } }, null, 2));
        return this.snapshot();
      } catch (error) {
        if (!previouslyGranted && this.grants.has('manual')) await this.revoke('manual');
        throw error;
      }
    });
  }

  revokeManual(signal: AbortSignal): Promise<DesignMcpSettings> {
    return this.enqueue(signal, async () => {
      await this.revoke('manual');
      return this.snapshot();
    });
  }

  async dispose(): Promise<void> {
    await this.server?.then((server) => server.close(), () => undefined);
  }

  private enqueue<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(async () => {
      await this.restore(signal);
      signal.throwIfAborted();
      return operation();
    });
    this.pending = result.catch(() => undefined);
    return result;
  }

  private snapshot(): DesignMcpSettings {
    return { codex: this.grants.has('codex'), 'claude-code': this.grants.has('claude-code'), manual: this.grants.has('manual') };
  }

  private config(source: DesignMcpSource): DesignMcpStdio {
    return {
      command: this.options.executable(),
      args: [join(this.options.appRoot, 'dist', 'electron', designMcpEntry), this.endpointFile(source)],
      env: { ELECTRON_RUN_AS_NODE: '1' },
    };
  }

  private endpointFile(source: DesignMcpSource): string {
    // Copied configurations stay tied to one grant, even if manual access is granted again later.
    return this.grants.get(source) ?? join(this.options.directory, source === 'manual' ? `manual-${randomUUID()}.json` : `${source}.json`);
  }

  private updateClient(client: DesignMcpClient, enabled: boolean, signal: AbortSignal): Promise<void> {
    return updateDesignMcpClient(this.options.clientFiles[client], client, this.config(client), enabled, signal);
  }

  private async authorize(source: DesignMcpSource, signal: AbortSignal): Promise<void> {
    if (this.authorized.has(source)) return;
    this.server ??= import('./loopback.js').then(async ({ DesignMcpLoopback }) => {
      const server = new DesignMcpLoopback((read, agent, requestSignal) => this.canvas.read(read, agent, requestSignal));
      try {
        await server.start(signal);
        return server;
      } catch (error) {
        this.server = undefined;
        await server.close();
        throw error;
      }
    });
    const server = await this.server;
    signal.throwIfAborted();
    await mkdir(this.options.directory, { recursive: true, mode: 0o700 });
    signal.throwIfAborted();
    const endpoint = server.authorize(source);
    try {
      const file = this.endpointFile(source);
      // Rollback needs the path even if the rename succeeds and directory sync fails.
      this.grants.set(source, file);
      await this.options.writeJsonAtomically(file, endpoint);
      signal.throwIfAborted();
      this.authorized.add(source);
    } catch (error) {
      server.revoke(source);
      throw error;
    }
  }

  private async deauthorize(source: DesignMcpSource): Promise<void> {
    if (this.authorized.delete(source)) (await this.server)?.revoke(source);
  }

  private async revoke(source: DesignMcpSource): Promise<void> {
    await this.deauthorize(source);
    const file = this.grants.get(source);
    if (!file) return;
    await rm(file, { force: true });
    this.grants.delete(source);
  }
}
