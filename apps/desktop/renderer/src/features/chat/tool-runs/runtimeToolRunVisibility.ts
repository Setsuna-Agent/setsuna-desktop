import type { RuntimeToolRun } from '@setsuna-desktop/contracts';

const HIDDEN_STATE_UPDATE_TOOLS = new Set(['update_goal', 'update_plan']);

/** State-update tools affect the surrounding UI, so duplicating them in the transcript adds no useful content. */
export function isTranscriptHiddenRuntimeToolRun(run: RuntimeToolRun): boolean {
  return HIDDEN_STATE_UPDATE_TOOLS.has(run.name);
}

export function isDisplayableRuntimeToolRun(run: RuntimeToolRun): boolean {
  if (run.status === 'error' || isTranscriptHiddenRuntimeToolRun(run)) return false;
  return Boolean(run.name || run.status || run.argumentsPreview || run.resultPreview);
}
