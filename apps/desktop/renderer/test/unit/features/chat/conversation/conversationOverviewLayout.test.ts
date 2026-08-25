import { describe, expect, it } from 'vitest';
import {
  canFitConversationOverviewPanel,
  doesConversationOverviewOverlapContent,
  needsConversationOverviewContentShift,
  shouldAutoHideConversationOverview,
  shouldCompactConversationOverview,
  shouldShiftConversationOverviewContent,
} from '../../../../../src/features/chat/conversation/conversationOverviewLayout.js';

describe('canFitConversationOverviewPanel', () => {
  it('preserves the content inset while centering it beside the expanded overview', () => {
    expect(canFitConversationOverviewPanel({ conversationWidth: 1169, contentWidth: 750 })).toBe(false);
    expect(canFitConversationOverviewPanel({ conversationWidth: 1170, contentWidth: 750 })).toBe(true);
    expect(canFitConversationOverviewPanel({ conversationWidth: 1390, contentWidth: 750 })).toBe(true);
  });

  it('keeps the panel compact when the content frame nearly fills the conversation', () => {
    expect(canFitConversationOverviewPanel({ conversationWidth: 760, contentWidth: 704 })).toBe(false);
  });

  it('detects when the measured compact chip would enter the content gutter', () => {
    expect(doesConversationOverviewOverlapContent({ conversationWidth: 900, contentWidth: 750, overviewWidth: 120 })).toBe(true);
    expect(doesConversationOverviewOverlapContent({ conversationWidth: 1200, contentWidth: 750, overviewWidth: 120 })).toBe(false);
    expect(doesConversationOverviewOverlapContent({ conversationWidth: 900, contentWidth: 750, overviewWidth: 0 })).toBe(false);
  });

  it('keeps content centered when the natural card gap is already at least 60px', () => {
    expect(needsConversationOverviewContentShift({ conversationWidth: 1470, contentWidth: 750 })).toBe(false);
    expect(shouldShiftConversationOverviewContent({ canExpand: true, compact: false, needsShift: false })).toBe(false);
  });

  it('centers content in the left lane only when the natural card gap is too small', () => {
    expect(needsConversationOverviewContentShift({ conversationWidth: 1469, contentWidth: 750 })).toBe(true);
    expect(shouldShiftConversationOverviewContent({ canExpand: true, compact: false, needsShift: true })).toBe(true);
    expect(shouldShiftConversationOverviewContent({ canExpand: false, compact: false, needsShift: true })).toBe(false);
    expect(shouldShiftConversationOverviewContent({ canExpand: true, compact: true, needsShift: true })).toBe(false);
  });

  it('lets an explicit user expand override the automatic compact layout', () => {
    expect(shouldCompactConversationOverview({ canExpand: false, manuallyCollapsed: false, manuallyExpanded: false })).toBe(true);
    expect(shouldCompactConversationOverview({ canExpand: false, manuallyCollapsed: false, manuallyExpanded: true })).toBe(false);
    expect(shouldCompactConversationOverview({ canExpand: true, manuallyCollapsed: true, manuallyExpanded: true })).toBe(true);
  });

  it('keeps an explicitly shown overview compact while preventing collision auto-hide', () => {
    const compact = shouldCompactConversationOverview({ canExpand: false, manuallyCollapsed: false, manuallyExpanded: false });

    expect(compact).toBe(true);
    expect(shouldAutoHideConversationOverview({ compact, explicitlyShown: false, overlapsContent: true })).toBe(true);
    expect(shouldAutoHideConversationOverview({ compact, explicitlyShown: true, overlapsContent: true })).toBe(false);
  });
});
