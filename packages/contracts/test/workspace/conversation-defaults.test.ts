import { expect, it } from 'vitest';
import { canFollowWorkspaceConversationDefaults, normalizeWorkspaceConversationDefaults, resolveWorkspaceConversationDefaults } from '../../src/workspace/conversation-defaults.js';

it('resolves a following chain and safely falls back for removed, archived or cyclic sources', () => {
  const defaults = { model: { providerId: 'provider', modelId: 'model' }, skillIds: ['skill'] };
  const source = { id: 'source', conversationDefaults: defaults };
  const middle = { id: 'middle', conversationDefaults: { sourceProjectId: source.id } };
  const follower = { id: 'follower', conversationDefaults: { sourceProjectId: middle.id } };
  expect(resolveWorkspaceConversationDefaults(follower, [source, middle, follower])).toEqual(defaults);
  expect(canFollowWorkspaceConversationDefaults(source.id, follower.id, [source, middle, follower])).toBe(false);
  expect(resolveWorkspaceConversationDefaults(follower, [middle, follower])).toBeUndefined();
  expect(resolveWorkspaceConversationDefaults(follower, [{ ...source, archivedAt: 'archived' }, middle, follower])).toBeUndefined();
  expect(resolveWorkspaceConversationDefaults(follower, [{ ...middle, conversationDefaults: { sourceProjectId: follower.id } }, follower])).toBeUndefined();
});

it('rejects mixed modes and malformed references at the persistence boundary', () => {
  expect(normalizeWorkspaceConversationDefaults({ sourceProjectId: ' source ' })).toEqual({ sourceProjectId: 'source' });
  expect(() => normalizeWorkspaceConversationDefaults({ sourceProjectId: '' })).toThrow();
  expect(() => normalizeWorkspaceConversationDefaults({ sourceProjectId: 'source', skillIds: ['skill'] })).toThrow('mutually exclusive');
});
