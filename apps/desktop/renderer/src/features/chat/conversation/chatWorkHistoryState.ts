export type WorkHistoryDisplayState = {
  active: boolean;
  expanded: boolean;
};

export function workHistoryDisplayState({
  hasFinalAnswerContent,
  runActive,
}: {
  hasFinalAnswerContent: boolean;
  runActive: boolean;
}): WorkHistoryDisplayState {
  if (runActive) {
    return { active: true, expanded: true };
  }
  return { active: false, expanded: !hasFinalAnswerContent };
}

/** 某条助手回复是否有展开中的工作记录面板；面板 ID 以 `${itemId}:work-history:` 为前缀。 */
export function hasExpandedWorkHistoryPanel(panelIds: ReadonlySet<string>, itemId: string): boolean {
  if (panelIds.has(itemId)) return true;
  const prefix = `${itemId}:work-history:`;
  return [...panelIds].some((panelId) => panelId.startsWith(prefix));
}

export function shouldCollapseCompletedWorkHistory({
  defaultExpanded,
  runActive,
  wasActive,
}: {
  defaultExpanded: boolean;
  runActive: boolean;
  wasActive: boolean;
}): boolean {
  return wasActive && !runActive && !defaultExpanded;
}
