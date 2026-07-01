import { describe, expect, it } from 'vitest';
import { canFitConversationOverviewPanel } from './conversationOverviewLayout.js';

describe('canFitConversationOverviewPanel', () => {
  it('requires enough right gutter or movable content space for the expanded overview', () => {
    expect(canFitConversationOverviewPanel({ conversationWidth: 1085, contentWidth: 750 })).toBe(false);
    expect(canFitConversationOverviewPanel({ conversationWidth: 1086, contentWidth: 750 })).toBe(true);
    expect(canFitConversationOverviewPanel({ conversationWidth: 1390, contentWidth: 750 })).toBe(true);
  });

  it('keeps the panel compact when the content frame nearly fills the conversation', () => {
    expect(canFitConversationOverviewPanel({ conversationWidth: 760, contentWidth: 704 })).toBe(false);
  });
});
