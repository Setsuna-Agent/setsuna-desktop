import type { BrowserSavedPassword } from '../../contracts/settings.js';

export type BrowserPasswordGroup = {
  origin: string;
  items: BrowserSavedPassword[];
};

export function groupBrowserSavedPasswords(items: readonly BrowserSavedPassword[], query: string): BrowserPasswordGroup[] {
  const search = query.trim().toLowerCase();
  const groups = new Map<string, BrowserPasswordGroup>();
  for (const item of items) {
    if (search && !`${item.origin} ${item.username}`.toLowerCase().includes(search)) continue;
    // Match the vault's exact origin boundary, including subdomains and ports.
    const group = groups.get(item.origin);
    if (group) group.items.push(item);
    else groups.set(item.origin, { origin: item.origin, items: [item] });
  }
  return Array.from(groups.values());
}
