import { workspaceTargetRootId, type WorkspaceProject, type WorkspaceEntrySearchResponse } from '@setsuna-desktop/contracts';
import { expect, it, vi } from 'vitest';
import { searchWorkspaceMentions } from '../../../../../src/features/chat/mentions/searchWorkspaceMentions.js';
import { parseWorkspaceMentionText } from '../../../../../src/features/chat/mentions/workspaceMentionParser.js';
import { entryLabel, parseMentionCommand } from '../../../../../src/features/chat/composer/chatCommandUtils.js';

const project: WorkspaceProject = {
  id: 'workspace', name: 'Workspace', path: '/repos/main', createdAt: '', updatedAt: '',
  roots: [{ id: 'main', path: '/repos/main' }, { id: 'child', path: '/repos/my agent' }],
};
const response: WorkspaceEntrySearchResponse = {
  query: '', scanned: 1, truncated: false, workspaceRoot: '',
  entries: [{ kind: 'file', name: 'same.ts', path: 'src/same.ts', parent: 'src' }],
};

it('offers roots, filters by the directory prefix and serializes an unambiguous spaced file path', async () => {
  const client = { searchProjectEntries: vi.fn().mockResolvedValue(response) };
  const choices = await searchWorkspaceMentions(client, project);
  expect(choices.entries.slice(0, 2).map((entry) => entry.absolutePath)).toEqual(['/repos/main', '/repos/my agent']);
  client.searchProjectEntries.mockClear();
  const command = parseMentionCommand('open @"my agent/src');
  expect(command?.query).toBe('my agent/src');
  const found = await searchWorkspaceMentions(client, project, command!.query);
  expect(client.searchProjectEntries).toHaveBeenCalledExactlyOnceWith({ projectId: 'workspace', rootId: 'child' }, 'src', undefined);
  expect(found.entries[0]).toMatchObject({ rootId: 'child', absolutePath: '/repos/my agent/src/same.ts' });
  expect(parseWorkspaceMentionText(`@${entryLabel(found.entries[0])}`)).toMatchObject([
    { type: 'mention', entryType: 'file', path: '/repos/my agent/src/same.ts' },
  ]);
});

it('keeps results from readable roots when a different source directory is unavailable', async () => {
  const searchProjectEntries = vi.fn(async (target) => {
    if (workspaceTargetRootId(target) === 'child') throw new Error('Directory unavailable');
    return response;
  });
  const result = await searchWorkspaceMentions({ searchProjectEntries }, project, 'same');
  expect(searchProjectEntries).toHaveBeenCalledTimes(2);
  expect(result.entries).toHaveLength(1);
  expect(result.entries[0]).toMatchObject({ rootId: 'main', absolutePath: '/repos/main/src/same.ts' });
});
