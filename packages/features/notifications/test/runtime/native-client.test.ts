import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { NativeNotificationClient } from '../../src/runtime/native-client.js';
import { NOTIFICATION_PATH } from '../../src/contracts/index.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function bridge(handler: (request: IncomingMessage, response: ServerResponse) => void) {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => new Promise((resolve, reject) => {
    server.closeAllConnections();
    server.close((error) => error ? reject(error) : resolve());
  }));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const client = new NativeNotificationClient(url, 'test-token');
  cleanups.push(() => client.close());
  return client;
}
const input = { id: 'thread:call', threadId: 'thread', title: 'Done', body: 'Ready' };

describe('native notification transport', () => {
  it('authenticates the fixed native route, sends source identity and validates receipts', async () => {
    let received: { path?: string; token?: string; input: unknown } | undefined;
    let receiptId = input.id;
    let systemNotification = 'shown';
    let nativeError: string | undefined;
    const client = await bridge((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        received = { path: request.url, token: request.headers.authorization, input: JSON.parse(Buffer.concat(chunks).toString()) };
        response.setHeader('content-type', 'application/json');
        response.statusCode = nativeError ? 400 : 200;
        response.end(JSON.stringify(nativeError ? { error: nativeError } : { id: receiptId, systemNotification }));
      });
    });
    await expect(client.send(input)).resolves.toEqual({ id: input.id, systemNotification: 'shown' });
    expect(received).toEqual({ path: NOTIFICATION_PATH, token: 'Bearer test-token', input });
    systemNotification = 'suppressed';
    await expect(client.send({ ...input, onlyWhenBackground: true }))
      .resolves.toEqual({ id: input.id, systemNotification: 'suppressed' });
    expect(received?.input).toEqual({ ...input, onlyWhenBackground: true });
    receiptId = 'another-notification';
    await expect(client.send(input)).rejects.toThrow('Invalid notification receipt');
    nativeError = 'System notification failed: UNErrorDomain错误1';
    await expect(client.send(input)).rejects.toThrow(nativeError);
  });

  it('requires loopback credentials and never follows redirects carrying the native bridge token', async () => {
    expect(NativeNotificationClient.fromEnvironment({})).toBeNull();
    expect(() => new NativeNotificationClient('https://example.com', 'token')).toThrow('loopback');
    expect(() => new NativeNotificationClient('http://127.0.0.1', '')).toThrow('loopback');
    const paths: string[] = [];
    const client = await bridge((request, response) => {
      paths.push(request.url!);
      response.writeHead(302, { Location: '/redirected' });
      response.end();
    });
    await expect(client.send(input)).rejects.toThrow();
    expect(paths).toEqual([NOTIFICATION_PATH]);
  });

  it('cancels an in-flight request without waiting for the native server response', async () => {
    let received!: () => void;
    const arrival = new Promise<void>((resolve) => { received = resolve; });
    const client = await bridge(() => received());
    const controller = new AbortController();
    const pending = expect(client.send(input, controller.signal)).rejects.toThrow();
    await arrival;
    controller.abort();
    await pending;
  });
});
