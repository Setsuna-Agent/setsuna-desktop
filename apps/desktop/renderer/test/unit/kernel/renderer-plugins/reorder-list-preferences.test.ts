import { describe, expect, it } from 'vitest';
import { emptyRendererLayoutPreferences } from '../../../../src/kernel/renderer-plugins/layout-preferences.js';
import { reorderListPreferences } from '../../../../src/kernel/renderer-plugins/reorder-list-preferences.js';

describe('reordering live sidebar apps', () => {
  it('moves across both ends without losing hidden entries or other layout settings', () => {
    const preferences = {
      ...emptyRendererLayoutPreferences(),
      singleSelections: { toolbar: 'compact' },
      listPreferences: {
        apps: { order: ['a', 'hidden', 'b', 'removed', 'c'], hiddenEntryIds: ['hidden'] },
        tools: { order: ['tool-two', 'tool-one'] },
      },
    };
    const top = reorderListPreferences(preferences, 'apps', ['a', 'b', 'c', 'new'], 'new', 'a', 'before')!;
    expect(top.listPreferences.apps).toEqual({ order: ['new', 'hidden', 'a', 'removed', 'b', 'c'], hiddenEntryIds: ['hidden'] });
    const bottom = reorderListPreferences(top, 'apps', ['new', 'a', 'b', 'c'], 'new', 'c', 'after')!;
    expect(bottom.listPreferences.apps.order).toEqual(['a', 'hidden', 'b', 'removed', 'c', 'new']);
    expect(bottom.singleSelections).toBe(preferences.singleSelections);
    expect(bottom.listPreferences.tools).toBe(preferences.listPreferences.tools);
    expect(preferences.listPreferences.apps.order).toEqual(['a', 'hidden', 'b', 'removed', 'c']);
  });

  it('does not save a cancelled, unchanged, or stale-app move', () => {
    const preferences = emptyRendererLayoutPreferences();
    const ids = ['a', 'b'];
    expect(reorderListPreferences(preferences, 'apps', ids, 'a', 'a', 'after')).toBeNull();
    expect(reorderListPreferences(preferences, 'apps', ids, 'a', 'b', 'before')).toBeNull();
    expect(reorderListPreferences(preferences, 'apps', ids, 'removed', 'b', 'after')).toBeNull();
    expect(reorderListPreferences(preferences, 'apps', ids, 'a', 'removed', 'before')).toBeNull();
  });
});
