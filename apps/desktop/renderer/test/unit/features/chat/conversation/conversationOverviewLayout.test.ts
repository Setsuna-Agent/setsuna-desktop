import { describe, expect, it } from 'vitest';
import { conversationOverviewLayout } from '../../../../../src/features/chat/conversation/conversationOverviewLayout.js';

describe('conversation overview content positioning', () => {
  it('shifts content beside the card only when both side insets fit', () => {
    expect(conversationOverviewLayout({ conversationWidth: 1163, contentWidth: 750 })).toBe('hidden');
    expect(conversationOverviewLayout({ conversationWidth: 1164, contentWidth: 750 })).toBe('shifted');
    expect(conversationOverviewLayout({ conversationWidth: 1457, contentWidth: 750 })).toBe('shifted');
  });

  it('keeps the content centered when its natural gap already fits the card', () => {
    expect(conversationOverviewLayout({ conversationWidth: 1458, contentWidth: 750 })).toBe('centered');
    expect(conversationOverviewLayout({ conversationWidth: 1600, contentWidth: 750 })).toBe('centered');
  });

  it('does not push content outside a narrow or unmeasured conversation', () => {
    expect(conversationOverviewLayout({ conversationWidth: 760, contentWidth: 704 })).toBe('hidden');
    expect(conversationOverviewLayout({ conversationWidth: 0, contentWidth: 750 })).toBe('hidden');
    expect(conversationOverviewLayout({ conversationWidth: 1200, contentWidth: 0 })).toBe('hidden');
  });
});
