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
    expect(latestCompletedReview([
      message('review_done', { kind: 'exited', review: 'Done', findings: [] }),
      message('review_active', { kind: 'entered', review: 'current changes' }),
    ])).toBeNull();
  });

  it('keeps findings across read-only turns and invalidates them after a successful file mutation', () => {
    const completed = message('review_done', { kind: 'exited', review: 'Done', findings: [] });
    const readOnlyTurn = assistantToolMessage('read_only', 'read_file');
    const mutationTurn = assistantToolMessage('mutation', 'write_file');

    expect(latestCompletedReview([completed, readOnlyTurn])).toMatchObject({ kind: 'exited' });
    expect(latestCompletedReview([completed, readOnlyTurn, mutationTurn])).toBeNull();
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
): RuntimeMessage {
  return {
    id,
    role: 'assistant',
    content: '',
    createdAt: '2026-08-12T00:00:00.000Z',
    status: 'complete',
    toolRuns: [{ id: `${id}_run`, name: toolName, status: 'success' }],
  };
}

function message(
  id: string,
  reviewMode: RuntimeReviewModeNotice,
): RuntimeMessage {
  return {
    id,
    role: 'system',
    content: '',
    createdAt: '2026-08-12T00:00:00.000Z',
    status: 'complete',
    reviewMode,
  };
}
