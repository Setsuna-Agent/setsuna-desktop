import type {
  DesktopDiffFile,
  RuntimeMessage,
  RuntimeReviewFinding,
  RuntimeReviewModeNotice,
} from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import {
  latestCompletedReview,
  reviewFindingAnnotationAnchor,
  reviewPathsMatch,
  resolveReviewFindingTarget,
} from '../../../../src/features/workspace/review-findings.js';

describe('reviewPathsMatch', () => {
  it('normalizes workspace and git prefixes without matching partial segments', () => {
    expect(reviewPathsMatch(
      './apps/desktop/src/review.ts',
      'apps/desktop/src/review.ts',
    )).toBe(true);
    expect(reviewPathsMatch(
      'a/apps/desktop/src/review.ts',
      'apps/desktop/src/review.ts',
    )).toBe(true);
    expect(reviewPathsMatch(
      'src/review.ts',
      'src/other-review.ts',
    )).toBe(false);
  });
});

describe('latestCompletedReview', () => {
  it('hides stale findings while a newer review is running', () => {
    const completed = message('review_done', { kind: 'exited', review: 'Done', findings: [] });
    const entered = message('review_active', { kind: 'entered', review: 'current changes' }, 'turn_active');

    expect(latestCompletedReview([completed, entered], 'turn_active')).toBeNull();
    expect(latestCompletedReview([completed, entered], null)).toMatchObject({ kind: 'exited' });
  });

  it('keeps findings across read-only turns and invalidates them after a potentially mutating tool', () => {
    const completed = message('review_done', { kind: 'exited', review: 'Done', findings: [] });
    const readOnlyTurn = assistantToolMessage('read_only', 'read_file');
    const mutationTurn = assistantToolMessage('mutation', 'write_file');
    const shellTurn = assistantToolMessage('shell', 'run_shell_command');
    const failedShellTurn = assistantToolMessage('failed_shell', 'run_shell_command', 'error');

    expect(latestCompletedReview([completed, readOnlyTurn], null)).toMatchObject({ kind: 'exited' });
    expect(latestCompletedReview([completed, readOnlyTurn, mutationTurn], null)).toBeNull();
    expect(latestCompletedReview([completed, readOnlyTurn, shellTurn], null)).toBeNull();
    expect(latestCompletedReview([completed, failedShellTurn], null)).toBeNull();
  });
});

describe('resolveReviewFindingTarget', () => {
  it('prefers an exact normalized path over an earlier suffix match', () => {
    const prefixed = diffFile([], 'packages/app/src/config.ts');
    const exact = diffFile([], 'src/config.ts');

    expect(resolveReviewFindingTarget({
      files: [prefixed, exact],
      additions: 0,
      deletions: 0,
    }, finding({ path: 'src/config.ts', startLine: 1 })).file).toBe(exact);
  });

  it('keeps case-distinct paths bound to the file named by the finding', () => {
    const lowerCase = diffFile([], 'src/foo.ts');
    const upperCase = diffFile([], 'src/Foo.ts');

    expect(resolveReviewFindingTarget({
      files: [lowerCase, upperCase],
      additions: 0,
      deletions: 0,
    }, finding({ path: 'src/Foo.ts', startLine: 1 })).file).toBe(upperCase);
  });
});

describe('reviewFindingAnnotationAnchor', () => {
  it('anchors a cited added line directly', () => {
    expect(reviewFindingAnnotationAnchor(diffFile([
      { type: 'added', lineNumber: 28, newLine: 28, content: 'added' },
    ]), finding({ startLine: 28 }))).toEqual({
      lineNumber: 28,
      side: 'additions',
    });
  });

  it('uses the nearest visible line within a cited range', () => {
    expect(reviewFindingAnnotationAnchor(diffFile([
      { type: 'context', lineNumber: 26, oldLine: 26, newLine: 26, content: 'context' },
      { type: 'added', lineNumber: 28, newLine: 28, content: 'added' },
    ]), finding({ startLine: 25, endLine: 29 }))).toEqual({
      lineNumber: 28,
      side: 'additions',
    });
  });

  it('falls back to the nearest retained deletion when the cited line is folded', () => {
    expect(reviewFindingAnnotationAnchor(diffFile([
      { type: 'removed', lineNumber: 17, oldLine: 17, content: 'removed' },
    ]), finding({ startLine: 20 }))).toEqual({
      lineNumber: 17,
      side: 'deletions',
    });
  });

  it('anchors replacement lines on the added side when both sides use the cited number', () => {
    expect(reviewFindingAnnotationAnchor(diffFile([
      { type: 'removed', lineNumber: 18, oldLine: 18, content: 'before' },
      { type: 'added', lineNumber: 18, newLine: 18, content: 'after' },
    ]), finding({ startLine: 18 }))).toEqual({
      lineNumber: 18,
      side: 'additions',
    });
  });

  it('uses the generic line number when a projected diff omits side-specific numbers', () => {
    expect(reviewFindingAnnotationAnchor(diffFile([
      { type: 'added', lineNumber: 32, content: 'added' },
    ]), finding({ startLine: 32 }))).toEqual({
      lineNumber: 32,
      side: 'additions',
    });
  });
});

function diffFile(lines: DesktopDiffFile['lines'], path = 'src/review.ts'): DesktopDiffFile {
  return {
    action: 'Modified',
    additions: 0,
    deletions: 0,
    lines,
    path,
    truncated: false,
  };
}

function finding(
  patch: Pick<RuntimeReviewFinding, 'startLine'> & Partial<RuntimeReviewFinding>,
): RuntimeReviewFinding {
  return {
    body: 'Body',
    path: 'src/review.ts',
    priority: 'P2',
    title: 'Finding',
    ...patch,
  };
}

function assistantToolMessage(
  id: string,
  toolName: string,
  status: 'success' | 'error' = 'success',
): RuntimeMessage {
  return {
    id,
    role: 'assistant',
    content: '',
    createdAt: '2026-08-12T00:00:00.000Z',
    status: 'complete',
    toolRuns: [{
      id: `${id}_run`,
      name: toolName,
      status,
      startedAt: '2026-08-12T00:00:00.000Z',
    }],
  };
}

function message(
  id: string,
  reviewMode: RuntimeReviewModeNotice,
  turnId?: string,
): RuntimeMessage {
  return {
    id,
    role: 'system',
    content: '',
    createdAt: '2026-08-12T00:00:00.000Z',
    status: 'complete',
    turnId,
    reviewMode,
  };
}
