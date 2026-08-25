const overviewPanelWidthPx = 284;
const overviewPanelRightInsetPx = 16;
const overviewExpandedContentGapPx = 60;
const overviewCompactContentGapPx = 24;
const overviewRightLaneWidthPx = overviewPanelWidthPx + overviewPanelRightInsetPx;
const overviewRequiredGutterPx = overviewRightLaneWidthPx + overviewExpandedContentGapPx;
const overviewContentCenterShiftPx = overviewRightLaneWidthPx / 2;

export function canFitConversationOverviewPanel({
  conversationWidth,
  contentWidth,
}: {
  conversationWidth: number;
  contentWidth: number;
}): boolean {
  const metrics = conversationOverviewGutterMetrics({ conversationWidth, contentWidth });
  if (!metrics) return false;
  return metrics.rightGutter + overviewContentCenterShiftPx >= metrics.requiredGutter
    && metrics.rightGutter - overviewContentCenterShiftPx >= overviewExpandedContentGapPx;
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
    ? metrics.rightGutter < overviewWidth + overviewPanelRightInsetPx + overviewCompactContentGapPx
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
  // 显式显示请求会固定紧凑入口，但可用留白过窄时不能强制打开完整面板。
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
    requiredGutter: overviewRequiredGutterPx,
    rightGutter: Math.max(0, (conversationWidth - contentWidth) / 2),
  };
}
