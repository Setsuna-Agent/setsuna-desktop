const overviewPanelWidthPx = 284;
const overviewPanelRightInsetPx = 10;
const overviewContentGapPx = overviewPanelRightInsetPx;

export type ConversationOverviewLayout = 'hidden' | 'centered' | 'shifted';

/** Keep the card visible only when it fits beside the content, with or without a shift. */
export function conversationOverviewLayout({
  conversationWidth,
  contentWidth,
  overviewWidth = overviewPanelWidthPx,
}: {
  conversationWidth: number;
  contentWidth: number;
  overviewWidth?: number;
}): ConversationOverviewLayout {
  if (conversationWidth <= 0 || contentWidth <= 0) return 'hidden';
  const overviewRightLaneWidthPx = overviewWidth + overviewPanelRightInsetPx;
  const overviewRequiredGutterPx = overviewRightLaneWidthPx + overviewContentGapPx;
  const overviewContentCenterShiftPx = overviewRightLaneWidthPx / 2;
  const rightGutter = Math.max(0, (conversationWidth - contentWidth) / 2);
  if (rightGutter >= overviewRequiredGutterPx) return 'centered';
  return rightGutter + overviewContentCenterShiftPx >= overviewRequiredGutterPx
    && rightGutter - overviewContentCenterShiftPx >= overviewContentGapPx
    ? 'shifted'
    : 'hidden';
}
