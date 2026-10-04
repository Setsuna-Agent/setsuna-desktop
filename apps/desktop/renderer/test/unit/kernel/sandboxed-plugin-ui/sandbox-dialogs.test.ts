import { expect, it, vi } from 'vitest';
import { sandboxDialogBootstrap, sandboxDialogEndpoint } from '../../../../src/kernel/sandboxed-plugin-ui/sandbox-dialogs.js';

const endpoint = `http://127.0.0.1:12345/v1/sandbox-dialogs/${'a'.repeat(64)}`;

it('preserves synchronous branching and fails explicitly on transport errors instead of inventing consent', () => {
  const open = vi.fn();
  const send = vi.fn();
  let status = 200;
  let response: unknown = false;
  const window = {
    XMLHttpRequest: class {
      open = open;
      send = send;
      setRequestHeader = vi.fn();
      get status() { return status; }
      get responseText() { return JSON.stringify({ value: response, error: 'Session closed' }); }
    },
  } as unknown as Window;
  new Function('window', sandboxDialogBootstrap(endpoint))(window);
  let deletions = 0;
  if (window.confirm('Delete?')) deletions++;
  expect(deletions).toBe(0);
  response = true;
  if (window.confirm('Delete?')) deletions++;
  expect(deletions).toBe(1);
  expect(open).toHaveBeenCalledWith('POST', endpoint, false);
  for (response of ['', null, 'New  name']) expect(window.prompt('Rename', 'Old')).toBe(response);
  expect(JSON.parse(send.mock.lastCall![0])).toEqual({ kind: 'prompt', message: 'Rename', defaultValue: 'Old' });
  response = { confirmed: true };
  expect(() => window.confirm('Delete?')).toThrow('Invalid confirmation');
  status = 400;
  expect(() => window.confirm('Delete?')).toThrow('Session closed');
});

it('rejects arbitrary network destinations and makes an unavailable desktop bridge explicit', () => {
  for (const url of ['https://example.com', 'http://127.0.0.1:12345/v1/projects', `${endpoint}?other=route`, `${endpoint}/../other`, endpoint.replace('127.0.0.1', 'user:secret@127.0.0.1')]) {
    expect(() => sandboxDialogEndpoint(url)).toThrow();
  }
  const window = {} as Window;
  new Function('window', sandboxDialogBootstrap())(window);
  expect(() => window.prompt('Name')).toThrow('Desktop dialogs are unavailable');
  expect(() => window.confirm('Delete?')).toThrow('Desktop dialogs are unavailable');
});
