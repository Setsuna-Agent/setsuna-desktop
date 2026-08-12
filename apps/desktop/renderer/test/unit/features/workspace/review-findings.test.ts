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

  it('uses the generic line number when a projected diff omits side-specific numbers', () => {
    expect(reviewFindingAnnotationAnchor(diffFile([
      { type: 'added', lineNumber: 32, content: 'added' },
    ]), finding({ startLine: 32 }))).toEqual({
      lineNumber: 32,
      side: 'additions',
    });
  });
});

function diffFile(lines: DesktopDiffFile['lines']): DesktopDiffFile {
  return {
    action: 'Modified',
    additions: 0,
    deletions: 0,
    lines,
    path: 'src/review.ts',
    truncated: false,
  };
}

function finding(
  lines: Pick<RuntimeReviewFinding, 'startLine' | 'endLine'>,
): RuntimeReviewFinding {
  return {
    body: 'Body',
    path: 'src/review.ts',
    priority: 'P2',
    title: 'Finding',
    ...lines,
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
