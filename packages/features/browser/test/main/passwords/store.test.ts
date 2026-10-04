import { describe, expect, it, vi } from 'vitest';
import { BrowserPasswordStore, passwordOrigin } from '../../../src/main/passwords/store.js';

describe('BrowserPasswordStore', () => {
  it('serializes concurrent saves, updates one account and deletes only within its exact origin', async () => {
    let encryptedEntry: string | undefined;
    const store = new BrowserPasswordStore({
      read: async () => encryptedEntry,
      write: async (value) => { encryptedEntry = value; },
    });
    await Promise.all([
      store.save('https://example.com', { username: 'alice', password: 'one' }),
      store.save('https://example.com', { username: 'bob', password: 'two' }),
      store.save('https://example.com:8443', { username: 'alice', password: 'other-port' }),
    ]);
    const alice = (await store.list('https://example.com'))[0];
    await store.save('https://example.com', { username: 'alice', password: 'updated' });
    expect(await store.list('https://example.com')).toEqual([
      { ...alice, password: 'updated' }, expect.objectContaining({ username: 'bob', password: 'two' }),
    ]);
    expect(await store.list('https://sub.example.com')).toEqual([]);
    expect(await store.list('http://example.com')).toEqual([]);
    await store.delete('https://example.com:8443', alice.id);
    expect(await store.list('https://example.com')).toHaveLength(2);
    await store.delete('https://example.com', alice.id);
    expect(await store.list('https://example.com')).toEqual([expect.objectContaining({ username: 'bob' })]);
    expect(await store.list('https://example.com:8443')).toHaveLength(1);
  });

  it('preserves unreadable data and recovers the mutation queue after an OS vault failure', async () => {
    let raw: string | undefined = '{invalid';
    const write = vi.fn(async (value: string) => { raw = value; });
    const store = new BrowserPasswordStore({ read: async () => raw, write });
    await expect(store.save('https://example.com', { username: 'a', password: 'secret' })).rejects.toThrow();
    expect(write).not.toHaveBeenCalled();
    raw = undefined;
    write.mockRejectedValueOnce(new Error('Keychain locked'));
    await expect(store.save('https://example.com', { username: 'a', password: 'secret' })).rejects.toThrow('Keychain locked');
    await store.save('https://example.com', { username: 'b', password: 'new' });
    expect(await store.list('https://example.com')).toEqual([expect.objectContaining({ username: 'b' })]);
  });

  it('permits secure origins and local development without normalizing unrelated sites together', () => {
    expect(passwordOrigin('https://EXAMPLE.com:443/login?q=x')).toBe('https://example.com');
    expect(passwordOrigin('http://localhost:5174/login')).toBe('http://localhost:5174');
    for (const url of ['http://example.com', 'https://user:secret@example.com', 'file:///login', 'about:blank', 'invalid']) {
      expect(passwordOrigin(url)).toBeNull();
    }
  });
});
