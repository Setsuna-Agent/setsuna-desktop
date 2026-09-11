const overviewPanelWidthPx = 284;
const overviewPanelRightInsetPx = 10;
const overviewContentGapPx = 60;
const overviewRightLaneWidthPx = overviewPanelWidthPx + overviewPanelRightInsetPx;
const overviewRequiredGutterPx = overviewRightLaneWidthPx + overviewContentGapPx;
const overviewContentCenterShiftPx = overviewRightLaneWidthPx / 2;

/** Shift only when both the card and the opposite content inset still fit. */
export function shouldShiftConversationOverviewContent({
  conversationWidth,
  contentWidth,
}: {
  conversationWidth: number;
  contentWidth: number;
}): boolean {
  if (conversationWidth <= 0 || contentWidth <= 0) return false;
  const rightGutter = Math.max(0, (conversationWidth - contentWidth) / 2);
  return rightGutter < overviewRequiredGutterPx
    && rightGutter + overviewContentCenterShiftPx >= overviewRequiredGutterPx
    && rightGutter - overviewContentCenterShiftPx >= overviewContentGapPx;
}
