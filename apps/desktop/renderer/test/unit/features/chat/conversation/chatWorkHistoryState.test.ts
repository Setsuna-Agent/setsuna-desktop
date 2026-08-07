import { describe, expect, it } from 'vitest';
import {
  shouldCollapseCompletedWorkHistory,
  workHistoryDisplayState,
} from '../../../../../src/features/chat/conversation/chatWorkHistoryState.js';

describe('workHistoryDisplayState', () => {
  it('keeps work history active and expanded while the assistant run is still active', () => {
    expect(workHistoryDisplayState({ runActive: true, hasFinalAnswerContent: true })).toEqual({
      active: true,
      expanded: true,
    });
  });

  it('keeps interrupted work expanded when no final answer was produced', () => {
    expect(workHistoryDisplayState({ runActive: false, hasFinalAnswerContent: false })).toEqual({
      active: false,
      expanded: true,
    });
  });

  it('allows completed work to collapse after final answer content exists', () => {
    expect(workHistoryDisplayState({ runActive: false, hasFinalAnswerContent: true })).toEqual({
      active: false,
      expanded: false,
    });
  });

  it('collapses a live work panel when a completed final answer replaces it', () => {
    expect(shouldCollapseCompletedWorkHistory({
      defaultExpanded: false,
      runActive: false,
      wasActive: true,
    })).toBe(true);
  });

  it('keeps interrupted work visible when no final answer exists', () => {
    expect(shouldCollapseCompletedWorkHistory({
      defaultExpanded: true,
      runActive: false,
      wasActive: true,
    })).toBe(false);
  });
});
