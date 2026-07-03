import { describe, expect, it } from 'vitest';
import {
  canFitConversationOverviewPanel,
  needsConversationOverviewContentShift,
  shouldCompactConversationOverview,
  shouldShiftConversationOverviewContent,
} from './conversationOverviewLayout.js';

describe('canFitConversationOverviewPanel', () => {
  it('requires enough right gutter or movable content space for the expanded overview', () => {
    expect(canFitConversationOverviewPanel({ conversationWidth: 1085, contentWidth: 750 })).toBe(false);
    expect(canFitConversationOverviewPanel({ conversationWidth: 1086, contentWidth: 750 })).toBe(true);
    expect(canFitConversationOverviewPanel({ conversationWidth: 1390, contentWidth: 750 })).toBe(true);
  });

  it('keeps the panel compact when the content frame nearly fills the conversation', () => {
    expect(canFitConversationOverviewPanel({ conversationWidth: 760, contentWidth: 704 })).toBe(false);
  });

  it('does not shift centered content when the right gutter can already hold the overview', () => {
    expect(needsConversationOverviewContentShift({ conversationWidth: 1390, contentWidth: 750 })).toBe(false);
    expect(shouldShiftConversationOverviewContent({ canExpand: true, compact: false, needsShift: false })).toBe(false);
  });

  it('shifts content only when the overview needs extra right gutter', () => {
    expect(needsConversationOverviewContentShift({ conversationWidth: 1086, contentWidth: 750 })).toBe(true);
    expect(shouldShiftConversationOverviewContent({ canExpand: true, compact: false, needsShift: true })).toBe(true);
    expect(shouldShiftConversationOverviewContent({ canExpand: false, compact: false, needsShift: true })).toBe(false);
    expect(shouldShiftConversationOverviewContent({ canExpand: true, compact: true, needsShift: true })).toBe(false);
  });

  it('lets an explicit user expand override the automatic compact layout', () => {
    expect(shouldCompactConversationOverview({ canExpand: false, manuallyCollapsed: false, manuallyExpanded: false })).toBe(true);
    expect(shouldCompactConversationOverview({ canExpand: false, manuallyCollapsed: false, manuallyExpanded: true })).toBe(false);
    expect(shouldCompactConversationOverview({ canExpand: true, manuallyCollapsed: true, manuallyExpanded: true })).toBe(true);
  });
});
