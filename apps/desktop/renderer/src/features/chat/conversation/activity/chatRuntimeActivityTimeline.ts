import type { RuntimeMessage, RuntimeToolRun } from '@setsuna-desktop/contracts';
import type { AssistantWorkItem } from '../chatAssistantTimeline.js';
import type { RuntimeHookUse } from './runtimeHookUsage.js';
import { isTranscriptHiddenRuntimeToolRun } from '../../tool-runs/runtimeToolRunVisibility.js';
import type { RuntimePluginUse } from '../../plugin-usage/runtimePluginUsage.js';

/** Plugin and Hook records share event positions, outside tool result disclosures. */
export function interleaveRuntimeActivities(
  segment: RuntimeMessage,
  body: AssistantWorkItem[],
  pluginUses: RuntimePluginUse[],
  includeUnanchored: boolean,
  hookUses: RuntimeHookUse[],
): AssistantWorkItem[] {
  const uses = pluginUses.filter((plugin) => plugin.anchor
    ? plugin.anchor.messageId === segment.id
    : includeUnanchored);
  const items: AssistantWorkItem[] = [];
  const hooks = hookUses.filter(({ anchor }) => anchor
    ? anchor.messageId === segment.id
    : includeUnanchored);
  const appendActivity = (placement: 'before' | 'after', toolRunId?: string) => {
    const plugins = uses.filter(({ anchor }) => (
      (anchor?.placement ?? 'before') === placement && anchor?.toolRunId === toolRunId
    ));
    if (plugins.length) items.push({
      type: 'pluginUses',
      id: `${segment.id}:plugins:${toolRunId ?? 'message'}:${placement}`,
      messageId: segment.id,
      plugins,
    });
    const runs = hooks.filter(({ anchor }) => (
      (anchor?.placement ?? 'before') === placement && anchor?.toolRunId === toolRunId
    )).map(({ run }) => run);
    if (runs.length) items.push({
      type: 'hookRuns',
      id: `${segment.id}:hooks:${toolRunId ?? 'message'}:${placement}`,
      messageId: segment.id,
      runs,
    });
  };

  appendActivity('before');
  items.push(...body);
  let runs: RuntimeToolRun[] = [];
  let groupCount = 0;
  const flushRuns = () => {
    if (!runs.length) return;
    items.push({
      type: 'toolRuns',
      id: groupCount++ === 0 ? `${segment.id}:tools` : `${segment.id}:tools:${runs[0]!.id}`,
      segment,
      toolRuns: runs,
    });
    runs = [];
  };
  for (const run of segment.toolRuns ?? []) {
    if (uses.some(({ anchor }) => anchor?.toolRunId === run.id)
      || hooks.some(({ anchor }) => anchor?.toolRunId === run.id)) {
      flushRuns();
      appendActivity('before', run.id);
      if (!isTranscriptHiddenRuntimeToolRun(run)) runs.push(run);
      flushRuns();
      appendActivity('after', run.id);
    } else if (!isTranscriptHiddenRuntimeToolRun(run)) {
      runs.push(run);
    }
  }
  flushRuns();
  appendActivity('after');
  return items;
}
