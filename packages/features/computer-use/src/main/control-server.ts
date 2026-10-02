import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { parseComputerCommand, type ComputerConnection, type ComputerControlPort } from '../contracts/index.js';

/** Separate bearer and fixed protocol; renderer never receives either connection field. */
export class ComputerControlServer {
  private readonly token = randomBytes(32).toString('hex');
  private readonly server = http.createServer((request, response) => { void this.handle(request, response); });
  constructor(private readonly control: ComputerControlPort) { this.server.requestTimeout = 35_000; }
  async start(): Promise<ComputerConnection> {
    this.server.listen(0, '127.0.0.1');
    await once(this.server, 'listening');
    const address = this.server.address();
    if (!address || typeof address === 'string') throw new Error('Desktop control did not bind.');
    return { url: `http://127.0.0.1:${address.port}`, token: this.token };
  }
  async stop(): Promise<void> {
    if (!this.server.listening) return;
    const closed = once(this.server, 'close');
    this.server.close();
    this.server.closeAllConnections();
    await closed;
  }
  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const send = (status: number, data: unknown) => { if (!response.destroyed) { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(data)); } };
    const availability = request.method === 'GET' && request.url === '/v1/computer/availability';
    if (!availability && (request.method !== 'POST' || request.url !== '/v1/computer/command')) { send(404, { error: 'Not found.' }); return; }
    if (request.headers.authorization !== `Bearer ${this.token}` || request.headers.origin) { send(401, { error: 'Unauthorized.' }); return; }
    if (availability) {
      try { send(200, { enabled: await this.control.isEnabled() }); }
      catch { send(503, { error: 'Desktop settings unavailable.' }); }
      return;
    }
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(new DOMException('Desktop command timed out.', 'TimeoutError')), 30_000);
    request.once('aborted', () => abort.abort(new Error('transport-disconnected')));
    response.once('close', () => { if (!response.writableEnded) abort.abort(new Error('transport-disconnected')); });
    try {
      let size = 0; const chunks: Buffer[] = [];
      for await (const chunk of request) {
        const buffer = Buffer.from(chunk); size += buffer.length;
        if (size > 16_384) throw new Error('Desktop command is too large.');
        chunks.push(buffer);
      }
      const command = parseComputerCommand(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      send(200, { result: await this.control.execute(command, abort.signal) });
    } catch (error) { send(400, { error: error instanceof Error ? error.message : 'Desktop control failed.' }); }
    finally { clearTimeout(timer); }
  }
}
