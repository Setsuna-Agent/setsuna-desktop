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
  const metrics = conversationOverviewGutterMetrics({ conversationWidth, contentWidth });
  return metrics ? metrics.rightGutter + overviewMaxContentShiftPx >= metrics.requiredGutter : false;
}

export function needsConversationOverviewContentShift({
  conversationWidth,
  contentWidth,
}: {
  conversationWidth: number;
  contentWidth: number;
}): boolean {
  const metrics = conversationOverviewGutterMetrics({ conversationWidth, contentWidth });
  return metrics ? metrics.rightGutter < metrics.requiredGutter : false;
}

export function doesConversationOverviewOverlapContent({
  conversationWidth,
  contentWidth,
  overviewWidth,
}: {
  conversationWidth: number;
  contentWidth: number;
  overviewWidth: number;
}): boolean {
  if (overviewWidth <= 0) return false;
  const metrics = conversationOverviewGutterMetrics({ conversationWidth, contentWidth });
  return metrics
    ? metrics.rightGutter < overviewWidth + overviewPanelRightInsetPx + overviewPanelContentGapPx
    : false;
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

export function shouldAutoHideConversationOverview({
  compact,
  explicitlyShown,
  overlapsContent,
}: {
  compact: boolean;
  explicitlyShown: boolean;
  overlapsContent: boolean;
}): boolean {
  // An explicit show request pins the compact entry in place, but must not force
  // the full panel open when the available gutter is too narrow.
  return compact && overlapsContent && !explicitlyShown;
}

export function shouldShiftConversationOverviewContent({
  canExpand,
  compact,
  needsShift,
}: {
  canExpand: boolean;
  compact: boolean;
  needsShift: boolean;
}): boolean {
  return canExpand && !compact && needsShift;
}

function conversationOverviewGutterMetrics({
  conversationWidth,
  contentWidth,
}: {
  conversationWidth: number;
  contentWidth: number;
}): { requiredGutter: number; rightGutter: number } | null {
  if (conversationWidth <= 0 || contentWidth <= 0) return null;
  return {
    requiredGutter: overviewPanelWidthPx + overviewPanelRightInsetPx + overviewPanelContentGapPx,
    rightGutter: Math.max(0, (conversationWidth - contentWidth) / 2),
  };
}
