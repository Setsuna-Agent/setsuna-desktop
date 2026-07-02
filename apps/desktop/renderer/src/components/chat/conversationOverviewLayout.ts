const overviewPanelWidthPx = 292;
const overviewPanelRightInsetPx = 16;
const overviewPanelContentGapPx = 12;
const overviewMaxContentShiftPx = 152;

export function canFitConversationOverviewPanel({
  conversationWidth,
  contentWidth,
}: {
  conversationWidth: number;
  contentWidth: number;
}): boolean {
  if (conversationWidth <= 0 || contentWidth <= 0) return false;
  const rightGutter = Math.max(0, (conversationWidth - contentWidth) / 2);
  const requiredGutter = overviewPanelWidthPx + overviewPanelRightInsetPx + overviewPanelContentGapPx;
  return rightGutter + overviewMaxContentShiftPx >= requiredGutter;
}

export function shouldCompactConversationOverview({
  canExpand,
  manuallyCollapsed,
  manuallyExpanded,
}: {
  canExpand: boolean;
  manuallyCollapsed: boolean;
  manuallyExpanded: boolean;
}): boolean {
  if (manuallyCollapsed) return true;
  return !canExpand && !manuallyExpanded;
}

export function shouldReserveConversationOverviewSpace({
  canExpand,
  compact,
}: {
  canExpand: boolean;
  compact: boolean;
}): boolean {
  return canExpand && !compact;
}
