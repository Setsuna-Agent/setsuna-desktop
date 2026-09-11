import { describe, expect, it } from 'vitest';
import { shouldShiftConversationOverviewContent } from '../../../../../src/features/chat/conversation/conversationOverviewLayout.js';

describe('conversation overview content positioning', () => {
  it('shifts content beside the card only when both side insets fit', () => {
    expect(shouldShiftConversationOverviewContent({ conversationWidth: 1163, contentWidth: 750 })).toBe(false);
    expect(shouldShiftConversationOverviewContent({ conversationWidth: 1164, contentWidth: 750 })).toBe(true);
    expect(shouldShiftConversationOverviewContent({ conversationWidth: 1457, contentWidth: 750 })).toBe(true);
  });

  it('keeps the content centered when its natural gap already fits the card', () => {
    expect(shouldShiftConversationOverviewContent({ conversationWidth: 1458, contentWidth: 750 })).toBe(false);
    expect(shouldShiftConversationOverviewContent({ conversationWidth: 1600, contentWidth: 750 })).toBe(false);
  });

  it('does not push content outside a narrow or unmeasured conversation', () => {
    expect(shouldShiftConversationOverviewContent({ conversationWidth: 760, contentWidth: 704 })).toBe(false);
    expect(shouldShiftConversationOverviewContent({ conversationWidth: 0, contentWidth: 750 })).toBe(false);
    expect(shouldShiftConversationOverviewContent({ conversationWidth: 1200, contentWidth: 0 })).toBe(false);
  });
});
