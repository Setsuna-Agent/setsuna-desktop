import { expect, it } from 'vitest';
import type { BrowserSavedPassword } from '../../../src/contracts/settings.js';
import { groupBrowserSavedPasswords } from '../../../src/renderer/settings/passwordGroups.js';

const items: BrowserSavedPassword[] = [
  { id: 'first', origin: 'https://example.org', username: 'alice' },
  { id: 'other', origin: 'https://other.org', username: 'alice' },
  { id: 'second', origin: 'https://example.org', username: 'bob' },
  { id: 'subdomain', origin: 'https://admin.example.org', username: 'admin' },
  { id: 'port', origin: 'https://example.org:8443', username: 'admin' },
];

it('groups interleaved accounts by their exact origin without merging subdomains or ports', () => {
  const groups = groupBrowserSavedPasswords(items, '');
  expect(groups.map((group) => [group.origin, group.items.map((item) => item.id)])).toEqual([
    ['https://example.org', ['first', 'second']],
    ['https://other.org', ['other']],
    ['https://admin.example.org', ['subdomain']],
    ['https://example.org:8443', ['port']],
  ]);
  expect(items.map((item) => item.id)).toEqual(['first', 'other', 'second', 'subdomain', 'port']);
});

it('matches all accounts for a website search and only matching accounts for a username search', () => {
  expect(groupBrowserSavedPasswords(items, ' HTTPS://EXAMPLE.ORG ')
    .map((group) => [group.origin, group.items.map((item) => item.id)])).toEqual([
    ['https://example.org', ['first', 'second']],
    ['https://example.org:8443', ['port']],
  ]);
  expect(groupBrowserSavedPasswords(items, ' BOB ')
    .map((group) => [group.origin, group.items.map((item) => item.id)])).toEqual([
    ['https://example.org', ['second']],
  ]);
  expect(groupBrowserSavedPasswords(items, 'missing')).toEqual([]);
});
