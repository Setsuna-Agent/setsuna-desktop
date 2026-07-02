import { describe, expect, it } from 'vitest';
import { canFitConversationOverviewPanel, shouldCompactConversationOverview, shouldReserveConversationOverviewSpace } from './conversationOverviewLayout.js';

describe('canFitConversationOverviewPanel', () => {
  it('requires enough right gutter or movable content space for the expanded overview', () => {
    expect(canFitConversationOverviewPanel({ conversationWidth: 1085, contentWidth: 750 })).toBe(false);
    expect(canFitConversationOverviewPanel({ conversationWidth: 1086, contentWidth: 750 })).toBe(true);
    expect(canFitConversationOverviewPanel({ conversationWidth: 1390, contentWidth: 750 })).toBe(true);
  });

  it('keeps the panel compact when the content frame nearly fills the conversation', () => {
    expect(canFitConversationOverviewPanel({ conversationWidth: 760, contentWidth: 704 })).toBe(false);
  });

  it('lets an explicit user expand override the automatic compact layout', () => {
    expect(shouldCompactConversationOverview({ canExpand: false, manuallyCollapsed: false, manuallyExpanded: false })).toBe(true);
    expect(shouldCompactConversationOverview({ canExpand: false, manuallyCollapsed: false, manuallyExpanded: true })).toBe(false);
    expect(shouldCompactConversationOverview({ canExpand: true, manuallyCollapsed: true, manuallyExpanded: true })).toBe(true);
  });

  it('only reserves layout space when the expanded overview can fit beside the content', () => {
    expect(shouldReserveConversationOverviewSpace({ canExpand: true, compact: false })).toBe(true);
    expect(shouldReserveConversationOverviewSpace({ canExpand: false, compact: false })).toBe(false);
    expect(shouldReserveConversationOverviewSpace({ canExpand: true, compact: true })).toBe(false);
  });
});
