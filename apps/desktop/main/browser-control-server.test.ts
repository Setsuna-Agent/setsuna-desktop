import { afterEach, describe, expect, it } from 'vitest';
import type { BrowserControlExecutor } from './browser-control.js';
import { BrowserControlServer, parseBrowserControlCommand } from './browser-control-server.js';

const servers: BrowserControlServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()));
});

describe('BrowserControlServer', () => {
  it('requires the per-launch bearer token and forwards typed commands', async () => {
    const calls: unknown[] = [];
    const executor: BrowserControlExecutor = {
      async execute(command) {
        calls.push(command);
        return { kind: 'tabs', tabs: [] };
      },
    };
    const server = new BrowserControlServer(executor);
    servers.push(server);
    const connection = await server.start();

    const unauthorized = await fetch(`${connection.url}/v1/browser/command`, {
      body: JSON.stringify({ kind: 'tabs' }),
      method: 'POST',
    });
    expect(unauthorized.status).toBe(401);

    const authorized = await fetch(`${connection.url}/v1/browser/command`, {
      body: JSON.stringify({ kind: 'snapshot', maxElements: 25, tabId: 'tab-1' }),
      headers: { Authorization: `Bearer ${connection.token}` },
      method: 'POST',
    });
    expect(authorized.status).toBe(200);
    await expect(authorized.json()).resolves.toEqual({ result: { kind: 'tabs', tabs: [] } });
    expect(calls).toEqual([{ kind: 'snapshot', maxElements: 25, tabId: 'tab-1' }]);
  });
});

describe('parseBrowserControlCommand', () => {
  it('preserves empty type text but rejects missing required fields', () => {
    expect(parseBrowserControlCommand({ kind: 'type', ref: 's1:t0:n1', text: '' })).toEqual({
      clear: undefined,
      kind: 'type',
      ref: 's1:t0:n1',
      submit: undefined,
      tabId: undefined,
      text: '',
    });
    expect(() => parseBrowserControlCommand({ kind: 'click' })).toThrow('ref must be a string');
    expect(parseBrowserControlCommand({ key: 'Tab', kind: 'key', modifiers: ['Shift'], repeat: 2 })).toEqual({
      key: 'Tab',
      kind: 'key',
      modifiers: ['Shift'],
      repeat: 2,
      tabId: undefined,
    });
  });
});
