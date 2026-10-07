import { expect, it } from 'vitest';
import { applyUpdates, normalizeRegistrations, normalizeWorldConfig, planUserScripts, userScriptsStateFrom } from '../../../../src/main/extensions/user-scripts/model.js';
import { matchesHost } from '../../../../src/main/extensions/user-scripts/match-pattern.js';

it('rejects reserved or duplicate IDs, ambiguous sources and invalid updates without changing registrations', () => {
  const input = { id: 'first', matches: ['https://*.example.org/*'], js: [{ code: '1' }] };
  const registered = normalizeRegistrations([input], new Set());
  for (const invalid of [{ ...input, id: '_reserved' }, { ...input, matches: ['invalid'] },
    { ...input, js: [{ code: '1', file: 'content.js' }] }, { ...input, world: 'MAIN', worldId: 'isolated' }]) {
    expect(() => normalizeRegistrations([invalid], new Set())).toThrow();
  }
  expect(() => normalizeRegistrations([input], new Set(['first']))).toThrow();
  expect(() => applyUpdates(registered, [{ id: 'missing', matches: input.matches }])).toThrow();
  expect(() => applyUpdates(registered, [{ id: 'first', allFrames: 'yes' }])).toThrow();
  expect(registered[0].allFrames).toBe(false);
  const updated = applyUpdates(registered, [{ id: 'first', runAt: 'document_end' }]);
  expect(updated[0].runAt).toBe('document_end');
  expect(registered[0].runAt).toBe('document_idle');
});

it('requires both permission and a matching registration, excludes privileged pages and separates worlds', () => {
  const scripts = normalizeRegistrations([
    { id: 'one', matches: ['https://*.example.org/*'], excludeMatches: ['https://example.org/private/*'], worldId: 'first', js: [{ code: '1' }] },
    { id: 'two', matches: ['<all_urls>'], allFrames: true, world: 'MAIN', js: [{ code: '2' }] },
  ], new Set());
  const state = { scripts, worlds: [normalizeWorldConfig({ worldId: 'first', messaging: true })] };
  const options = { hostAccess: (url: string) => matchesHost(url, ['https://*.example.org/public/*']), allowFileAccess: false };
  const plan = (url: string, allowed = true, isTopFrame = true) => planUserScripts(state, allowed, { url, isTopFrame }, options);
  expect(plan('https://other.test/')).toEqual([]);
  expect(plan('https://example.org:8443/')).toHaveLength(2);
  expect(plan('https://example.org/', false)).toEqual([]);
  expect(plan('chrome-extension://any/page')).toEqual([]);
  expect(plan('file:///private/script.html')).toEqual([]);
  expect(plan('https://example.org/private/secret').map((world) => world.scripts.map((script) => script.id))).toEqual([['two']]);
  expect(plan('https://sub.example.org/', true, false).map((world) => world.world)).toEqual(['MAIN']);
  expect(plan('https://example.org/').map((world) => [world.world, world.worldId, world.messaging])).toEqual([
    ['USER_SCRIPT', 'first', true], ['MAIN', null, false],
  ]);
  expect(userScriptsStateFrom({ version: 1, scripts: [{ ...scripts[0], id: '_invalid' }], worlds: [] }).scripts).toEqual([]);
});
