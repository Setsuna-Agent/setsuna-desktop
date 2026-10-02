import { afterEach, describe, expect, it, vi } from 'vitest';
import { ComputerControlServer } from '../../src/main/control-server.js';
const servers: ComputerControlServer[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => server.stop())); });
describe('desktop loopback server', () => {
  it('requires a separate token, rejects browser origins and validates trusted identity', async () => {
    const execute = vi.fn(async () => ({ kind: 'stopped' as const }));
    const server = new ComputerControlServer({ execute, isEnabled: async () => false }); servers.push(server);
    const connection = await server.start();
    const send = (body: unknown, headers = {}) => fetch(`${connection.url}/v1/computer/command`, { method: 'POST', body: JSON.stringify(body), headers });
    const command = { kind: 'stop', identity: { threadId: 'thread', turnId: 'turn', unattended: false, readOnly: false, supportsImages: true } };
    expect((await send(command)).status).toBe(401);
    const auth = { Authorization: `Bearer ${connection.token}` };
    const availability = `${connection.url}/v1/computer/availability`;
    expect((await fetch(availability)).status).toBe(401);
    expect((await fetch(availability, { headers: { ...auth, Origin: 'https://evil.example' } })).status).toBe(401);
    expect(await (await fetch(availability, { headers: auth })).json()).toEqual({ enabled: false });
    expect((await fetch(availability, { method: 'POST', headers: auth, body: '{"enabled":true}' })).status).toBe(404);
    expect((await send(command, { ...auth, Origin: 'https://evil.example' })).status).toBe(401);
    expect((await send({ kind: 'start' }, auth)).status).toBe(400);
    expect((await send({ ...command, ignored: 'x'.repeat(20_000) }, auth)).status).toBe(400);
    expect((await send(command, auth)).status).toBe(200);
    expect(execute).toHaveBeenCalledExactlyOnceWith({ ...command, reason: 'requested' }, expect.any(AbortSignal));
  });
  it('cancels execution when the runtime connection closes', async () => {
    let received: AbortSignal | undefined;
    const server = new ComputerControlServer({ isEnabled: async () => true, execute: async (_command, signal) => {
      received = signal;
      return new Promise((resolve) => signal?.addEventListener('abort', () => resolve({ kind: 'stopped' }), { once: true }));
    } }); servers.push(server);
    const connection = await server.start(); const abort = new AbortController();
    const pending = fetch(`${connection.url}/v1/computer/command`, {
      method: 'POST', headers: { Authorization: `Bearer ${connection.token}` }, signal: abort.signal,
      body: JSON.stringify({ kind: 'start', identity: { threadId: 't', turnId: 'u', unattended: false, readOnly: false, supportsImages: true } }),
    });
    const rejected = expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(received).toBeDefined()); abort.abort(); await rejected;
    await vi.waitFor(() => expect(received?.aborted).toBe(true));
  });
});
