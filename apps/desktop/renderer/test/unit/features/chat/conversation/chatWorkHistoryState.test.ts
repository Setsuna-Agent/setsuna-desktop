import { describe, expect, it } from 'vitest';
import { workHistoryDisplayState } from '../../../../../src/features/chat/conversation/chatWorkHistoryState.js';

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
});
