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
