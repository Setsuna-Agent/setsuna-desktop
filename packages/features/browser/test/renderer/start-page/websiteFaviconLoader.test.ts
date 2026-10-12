import { expect, it, vi } from 'vitest';
import { createWebsiteFaviconLoader } from '../../../src/renderer/start-page/websiteFaviconLoader.js';

it('does no eager work and reuses one site-root request across history, bookmarks and pins', async () => {
  const resolve = vi.fn(async () => 'data:image/png;base64,aWNvbg==');
  const loader = createWebsiteFaviconLoader(resolve);
  expect(resolve).not.toHaveBeenCalled();
  const first = loader.load('https://example.com/logout?next=/');
  const duplicate = loader.load('https://example.com/docs#intro');
  expect(first).toBe(duplicate);
  expect(await first).toBe('data:image/png;base64,aWNvbg==');
  expect(await loader.load('https://example.com/settings')).toBe(await first);
  expect(resolve).toHaveBeenCalledExactlyOnceWith('https://example.com/');
  for (const url of ['invalid', 'file:///tmp/page.html', 'https://user:password@example.com/']) {
    expect(await loader.load(url)).toBeNull();
  }
  expect(resolve).toHaveBeenCalledOnce();
  loader.dispose();
});

it('bounds slow requests, continues after failure, and drops queued work when the panel closes', async () => {
  const requests: Array<{ resolve(value: string | null): void; reject(error: Error): void }> = [];
  const resolve = vi.fn(() => new Promise<string | null>((resolve, reject) => { requests.push({ resolve, reject }); }));
  const loader = createWebsiteFaviconLoader(resolve);
  const results = Array.from({ length: 6 }, (_, index) => loader.load(`https://site${index}.example/`));
  await vi.waitFor(() => expect(resolve).toHaveBeenCalledTimes(3));
  requests[0].reject(new Error('offline'));
  expect(await results[0]).toBeNull();
  await vi.waitFor(() => expect(resolve).toHaveBeenCalledTimes(4));
  expect(await loader.load('https://site0.example/again')).toBeNull();
  loader.dispose();
  expect(await Promise.all(results.slice(4))).toEqual([null, null]);
  requests.slice(1).forEach((request) => request.resolve('late icon'));
  expect(await Promise.all(results)).toEqual([null, null, null, null, null, null]);
  expect(await loader.load('https://new.example/')).toBeNull();
  expect(resolve).toHaveBeenCalledTimes(4);
});
