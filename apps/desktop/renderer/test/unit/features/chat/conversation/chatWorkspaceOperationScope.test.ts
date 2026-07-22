import { describe, expect, it } from 'vitest';
import {
  commitChatWorkspaceOperation,
} from '../../../../../src/features/chat/conversation/chatWorkspaceOperationScope.js';
import { createIdentityRequestGuard } from '../../../../../src/shared/hooks/useIdentityRequestGuard.js';

describe('commitChatWorkspaceOperation', () => {
  it('blocks every delayed A continuation after switching to B', () => {
    const operations = createIdentityRequestGuard('thread:A');
    const isCurrentA = operations.begin();
    const commits: string[] = [];

    operations.updateIdentity('thread:B');
    commitChatWorkspaceOperation(isCurrentA, () => commits.push('success-A'));
    commitChatWorkspaceOperation(isCurrentA, () => commits.push('catch-A'));
    commitChatWorkspaceOperation(isCurrentA, () => commits.push('finally-A'));

    const isCurrentB = operations.begin();
    commitChatWorkspaceOperation(isCurrentB, () => commits.push('success-B'));
    expect(commits).toEqual(['success-B']);
  });

  it('blocks an older operation when B starts a newer operation in the same session', () => {
    const operations = createIdentityRequestGuard('thread:B');
    const firstB = operations.begin();
    const secondB = operations.begin();
    const commits: string[] = [];

    commitChatWorkspaceOperation(firstB, () => commits.push('old-B'));
    commitChatWorkspaceOperation(secondB, () => commits.push('new-B'));
    expect(commits).toEqual(['new-B']);
  });
});
