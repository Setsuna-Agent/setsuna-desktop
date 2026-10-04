import { EventEmitter } from 'node:events';
import type { WebContents } from 'electron';
import { afterEach, expect, it, vi } from 'vitest';
import type { BrowserPasswordState } from '../../../src/contracts/passwords.js';
import { BrowserPasswordSession } from '../../../src/main/passwords/session.js';
import { BrowserPasswordStore } from '../../../src/main/passwords/store.js';
import { DEFAULT_BROWSER_PREFERENCES, type BrowserPreferences } from '../../../src/contracts/settings.js';

const sessions: BrowserPasswordSession[] = [];
afterEach(() => { for (const session of sessions.splice(0)) session.dispose(); });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}

async function fixture(saved = true, preferences: () => BrowserPreferences = () => DEFAULT_BROWSER_PREFERENCES) {
  let raw: string | undefined;
  let url = 'https://example.com/login';
  const store = new BrowserPasswordStore({ read: async () => raw, write: async (value) => { raw = value; } });
  if (saved) await store.save('https://example.com', { username: 'alice', password: 'secret' });
  const watches: ReturnType<typeof deferred<unknown>>[] = [];
  const send = vi.fn((_channel: string, _state: BrowserPasswordState) => undefined);
  const execute = vi.fn((_world: number, scripts: { code: string }[]) => {
    if (scripts[0].code.includes('"kind":"watch"')) {
      const watch = deferred<unknown>();
      watches.push(watch);
      return watch.promise;
    }
    return Promise.resolve(true);
  });
  const guest = Object.assign(new EventEmitter(), {
    id: 2, hostWebContents: { id: 1, send, isDestroyed: () => false },
    getURL: () => url, isDestroyed: () => false, isLoadingMainFrame: () => false,
    executeJavaScriptInIsolatedWorld: execute,
  });
  const session = new BrowserPasswordSession('tab', guest as unknown as WebContents, store, preferences);
  sessions.push(session);
  await session.getState();
  const event = async (value: unknown) => {
    await vi.waitFor(() => expect(watches.length).toBeGreaterThan(0));
    watches.shift()!.resolve(value);
  };
  const navigate = (next: string) => {
    guest.emit('did-start-navigation', {}, next, false, true);
    watches.length = 0;
    url = next;
    guest.emit('dom-ready');
  };
  return { store, send, session, guest, execute, event, navigate };
}

it('requires an explicit save, exposes only metadata and binds pending credentials to the pre-redirect origin', async () => {
  const { store, session, send, event, navigate } = await fixture(false);
  await event({ kind: 'submit', username: 'alice', password: 'private-password' });
  await vi.waitFor(() => expect(send.mock.lastCall?.[1].prompt).toBeTruthy());
  const prompt = (await session.getState()).prompt!;
  expect(await store.list('https://example.com')).toEqual([]);
  expect(JSON.stringify(send.mock.calls)).not.toContain('private-password');
  navigate('https://other.example/return');
  await expect(session.save('wrong-request')).resolves.toBe(false);
  await expect(session.save(prompt.id)).resolves.toBe(true);
  expect(await store.list('https://other.example')).toEqual([]);
  expect(await store.list('https://example.com')).toEqual([expect.objectContaining({ password: 'private-password' })]);
  await expect(session.save(prompt.id)).resolves.toBe(false);
});

it('suppresses saved credentials and asks before replacing a changed password', async () => {
  const { store, session, event, send } = await fixture();
  await event({ kind: 'submit', username: 'alice', password: 'secret' });
  await vi.waitFor(() => expect(send.mock.lastCall?.[1].prompt).toBeNull());
  await event({ kind: 'submit', username: 'alice', password: 'changed' });
  await vi.waitFor(() => expect(send.mock.lastCall?.[1].prompt?.update).toBe(true));
  const prompt = (await session.getState()).prompt!;
  expect((await store.list('https://example.com'))[0].password).toBe('secret');
  await session.save(prompt.id);
  expect((await store.list('https://example.com'))[0].password).toBe('changed');
});

it.each(['https://evil.example/login', 'https://example.com/next'])('discards a delayed vault result after navigation to %s', async (destination) => {
  const { store, session, execute, navigate } = await fixture();
  const logins = await store.list('https://example.com');
  const lookup = deferred<typeof logins>();
  vi.spyOn(store, 'list').mockReturnValueOnce(lookup.promise);
  const pending = session.fill(logins[0].id);
  navigate(destination);
  lookup.resolve(logins);
  await expect(pending).resolves.toBe(false);
  expect(execute.mock.calls.some(([, scripts]) => scripts[0].code.includes('"kind":"fill"'))).toBe(false);
});

it('automatically fills only a single matching account and releases stalled guest work on disposal', async () => {
  const { store, session, execute, event } = await fixture();
  await event({ kind: 'form', formId: '1' });
  await vi.waitFor(() => expect(execute.mock.calls.some(([, scripts]) => scripts[0].code.includes('"formId":"1"'))).toBe(true));
  await store.save('https://example.com', { username: 'bob', password: 'second' });
  execute.mockClear();
  await event({ kind: 'form', formId: '2' });
  await session.getState();
  expect(execute.mock.calls.some(([, scripts]) => scripts[0].code.includes('"kind":"fill"'))).toBe(false);
  const login = (await store.list('https://example.com'))[0];
  execute.mockImplementation((_world, scripts) => scripts[0].code.includes('"kind":"fill"') ? new Promise(() => undefined) : Promise.resolve(true));
  const filling = session.fill(login.id);
  await vi.waitFor(() => expect(execute.mock.calls.some(([, scripts]) => scripts[0].code.includes('"kind":"fill"'))).toBe(true));
  session.dispose();
  await expect(filling).resolves.toBe(false);
});

it('honors live save and autofill preferences while retaining explicit account filling', async () => {
  let preferences = { ...DEFAULT_BROWSER_PREFERENCES, autofillPasswords: false, savePasswords: false };
  const { store, session, execute, event } = await fixture(true, () => preferences);
  await event({ kind: 'form', formId: 'disabled-form' });
  await event({ kind: 'submit', username: 'alice', password: 'new-password' });
  expect((await session.getState()).prompt).toBeNull();
  expect(execute.mock.calls.some(([, scripts]) => scripts[0].code.includes('"kind":"fill"'))).toBe(false);
  const login = (await store.list('https://example.com'))[0];
  await expect(session.fill(login.id)).resolves.toBe(true);
  preferences = { ...preferences, savePasswords: true };
  await event({ kind: 'submit', username: 'alice', password: 'new-password' });
  await vi.waitFor(async () => expect((await session.getState()).prompt).not.toBeNull());
  const prompt = (await session.getState()).prompt!;
  preferences = { ...preferences, savePasswords: false };
  session.refreshPreferences();
  expect((await session.getState()).prompt).toBeNull();
  await expect(session.save(prompt.id)).resolves.toBe(false);
  expect((await store.list('https://example.com'))[0].password).toBe('secret');
});
