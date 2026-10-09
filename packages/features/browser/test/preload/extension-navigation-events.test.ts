import { afterEach, expect, it, vi } from 'vitest';
import type { ExtensionSystemEvent } from '../../src/contracts/extension-api.js';
import { installExtensionNavigationEvents } from '../../src/preload/extension-navigation-events.js';

afterEach(() => vi.unstubAllGlobals());
it('delivers only each listener\'s registered URL set, including alternatives, combined conditions and removal', () => {
  type Listener = (details: Record<string, unknown>) => void;
  type Event = { addListener(listener: Listener, filter?: unknown): void; removeListener(listener: Listener): void };
  const navigation = {} as Record<string, Event>;
  vi.stubGlobal('chrome', { webNavigation: navigation });
  let receive!: (event: ExtensionSystemEvent) => void;
  installExtensionNavigationEvents({ onEvent: listener => { receive = listener; } });
  const all = vi.fn(); const selected = vi.fn(); const target = vi.fn(); const regex = vi.fn();
  const filters = { url: [{ hostSuffix: '.test', pathPrefix: '/selected', schemes: ['https'], ports: [443] },
    { hostEquals: 'localhost', queryEquals: 'allowed=yes', ports: [[8000, 9000]] }] };
  navigation.onCommitted.addListener(all);
  navigation.onCommitted.addListener(selected, filters);
  navigation.onCommitted.addListener(regex, { url: [{ urlMatches: '^https://site\\.test/selected\\?', queryContains: 'allowed=yes' }] });
  navigation.onCreatedNavigationTarget.addListener(target, { url: [{ hostContains: '.site', urlSuffix: '?allowed=yes' }] });
  filters.url[0].hostSuffix = '.changed';
  const send = (url: string, kind: 'navigationCommitted' | 'navigationTargetCreated' = 'navigationCommitted') => receive({ kind, details: { url } });
  send('https://site.test/other');
  send('http://site.test/selected?allowed=yes');
  send('https://site.test/selected?allowed=yes#fragment');
  send('https://localhost:8500/other?allowed=yes');
  send('https://localhost:9500/other?allowed=yes');
  send('https://site.test/selected?allowed=yes#fragment', 'navigationTargetCreated');
  expect(all).toHaveBeenCalledTimes(5);
  expect(selected.mock.calls.map(([details]) => details.url)).toEqual([
    'https://site.test/selected?allowed=yes#fragment', 'https://localhost:8500/other?allowed=yes',
  ]);
  expect(regex).toHaveBeenCalledOnce(); expect(target).toHaveBeenCalledOnce();
  navigation.onCommitted.removeListener(selected);
  send('https://site.test/selected');
  expect(selected).toHaveBeenCalledTimes(2);
});

it('rejects unsupported or invalid filters before registration and treats an empty URL set as no match', () => {
  const navigation = {} as Record<string, { addListener(listener: () => void, filter: unknown): void }>;
  vi.stubGlobal('chrome', { webNavigation: navigation });
  let receive!: (event: ExtensionSystemEvent) => void;
  installExtensionNavigationEvents({ onEvent: listener => { receive = listener; } });
  const listener = vi.fn();
  for (const filter of [{ url: [{ ports: [[9000, 8000]] }] }, { url: [{ hostSuffix: 10 }] },
    { url: [{ cidrBlocks: ['127.0.0.0/8'] }] }, { url: [{ urlMatches: '(' }] }]) {
    expect(() => navigation.onCommitted.addListener(listener, filter)).toThrow();
  }
  navigation.onCommitted.addListener(listener, { url: [] });
  receive({ kind: 'navigationCommitted', details: { url: 'https://site.test/' } });
  expect(listener).not.toHaveBeenCalled();
});
