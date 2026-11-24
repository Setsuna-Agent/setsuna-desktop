import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { DesignMcpAgent, DesignMcpClient, DesignMcpRead, DesignMcpReadResult, DesignMcpReply } from '../../contracts/design-mcp.js';
import { designMcpReadRequest } from './read-request.js';

export type DesignMcpSource = DesignMcpClient | 'manual';
type Credential = { token: string; active: AbortController };
export type DesignMcpEndpoint = { port: number; token: string };
type ReadCanvas = (read: DesignMcpRead, agent: DesignMcpAgent, signal: AbortSignal) => Promise<DesignMcpReadResult>;

// A batch can contain projected layer IDs up to 1024 characters each.
const maxRequestBytes = 64 * 1024;
const requestTimeoutMs = 20_000;
const clientNames = { codex: 'Codex', 'claude-code': 'Claude Code' };

export class DesignMcpLoopback {
  private readonly credentials = new Map<DesignMcpSource, Credential>();
  private readonly server: Server;
  private count = 0;
  private port?: number;

  constructor(private readonly readCanvas: ReadCanvas) {
    this.server = createServer({ requestTimeout: requestTimeoutMs }, (request, response) => {
      void this.handle(request, response);
    });
  }

  async start(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', () => {
        this.server.off('error', reject);
        this.port = (this.server.address() as { port: number }).port;
        resolve();
      });
    });
    signal.throwIfAborted();
  }

  authorize(source: DesignMcpSource): DesignMcpEndpoint {
    if (!this.port) throw new Error('Setsuna Design MCP is unavailable.');
    let credential = this.credentials.get(source);
    if (!credential) {
      credential = { token: randomBytes(32).toString('hex'), active: new AbortController() };
      this.credentials.set(source, credential);
    }
    return { port: this.port, token: credential.token };
  }

  revoke(source: DesignMcpSource): void {
    this.credentials.get(source)?.active.abort();
    this.credentials.delete(source);
  }

  async close(): Promise<void> {
    for (const source of this.credentials.keys()) this.revoke(source);
    if (!this.server.listening) return;
    const closed = new Promise<void>((resolve) => { this.server.close(() => resolve()); });
    this.server.closeAllConnections();
    await closed;
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method !== 'POST' || request.url !== '/read') {
      return send(response, 404, { ok: false, error: 'Unknown Setsuna Design MCP route.' });
    }
    const token = request.headers.authorization?.match(/^Bearer ([0-9a-f]{64})$/u)?.[1];
    const authorized = token && [...this.credentials].find(([, entry]) => timingSafeEqual(Buffer.from(entry.token), Buffer.from(token)));
    if (!authorized) return send(response, 401, { ok: false, error: 'This client is not enabled in Setsuna Design.' });
    if (this.count >= 4) return send(response, 429, { ok: false, error: 'Setsuna Design is busy. Use layerIds to combine inspections or retry the read.' });

    const [source, { active }] = authorized;
    const disconnected = new AbortController();
    response.once('close', () => disconnected.abort());
    const signal = AbortSignal.any([active.signal, disconnected.signal, AbortSignal.timeout(requestTimeoutMs)]);
    this.count += 1;
    try {
      const input = designMcpReadRequest.safeParse(await readBody(request, signal));
      if (!input.success) return send(response, 400, { ok: false, error: 'Invalid design read request.' });
      const { agent, read } = input.data;
      const name = source === 'manual' ? agent.name.replace(/[\p{Cc}\p{Cf}]/gu, '').trim().slice(0, 48) || 'MCP Agent' : clientNames[source];
      const value = await this.readCanvas(read, { id: `${source}:${agent.id}`, name }, signal);
      signal.throwIfAborted();
      send(response, 200, { ok: true, value });
    } catch (error) {
      const message = signal.aborted ? 'The design read was cancelled or timed out.'
        : error instanceof Error ? error.message : 'Setsuna Design could not read the active draft.';
      send(response, 400, { ok: false, error: message });
    } finally {
      this.count -= 1;
    }
  }
}

async function readBody(request: IncomingMessage, signal: AbortSignal): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  const abort = () => { request.destroy(); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    signal.throwIfAborted();
    for await (const chunk of request) {
      bytes += chunk.length;
      if (bytes > maxRequestBytes) throw new Error('Design read request is too large.');
      chunks.push(chunk);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new Error('Invalid design read request.');
    }
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

function send(response: ServerResponse, status: number, reply: DesignMcpReply): void {
  if (response.destroyed) return;
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(reply));
}
