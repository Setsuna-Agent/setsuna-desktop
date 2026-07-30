import { describe, expect, it } from 'vitest';
import {
  fallbackRuntimeGeneratedCommitMessage,
  normalizeRuntimeGeneratedCommitMessage,
} from '../../../src/runtime/use-cases/commit-message-generation.js';

describe('runtime commit message generation', () => {
  it('normalizes fenced, labelled, and invisible provider output', () => {
    expect(normalizeRuntimeGeneratedCommitMessage(
      '```text\n\u200BCommit message: "feat: refine review flow"\n```',
    )).toBe('feat: refine review flow');
  });

  it('uses deterministic fallbacks based on porcelain status paths', () => {
    expect(fallbackRuntimeGeneratedCommitMessage(
      ' M src/chat.ts',
      'diff --git a/src/chat.ts b/src/chat.ts',
    )).toBe('chore: update src/chat.ts');
    expect(fallbackRuntimeGeneratedCommitMessage(
      'R  old.ts -> new.ts\n?? docs.md',
      '',
    )).toBe('chore: update 2 files');
    expect(fallbackRuntimeGeneratedCommitMessage('', 'diff --git a/a b/a'))
      .toBe('chore: update changes');
  });
});
