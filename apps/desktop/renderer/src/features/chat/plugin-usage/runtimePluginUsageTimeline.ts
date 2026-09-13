import type { RuntimeMessage, RuntimeToolRun } from '@setsuna-desktop/contracts';
import type { AssistantWorkItem } from '../conversation/chatAssistantTimeline.js';
import { isTranscriptHiddenRuntimeToolRun } from '../tool-runs/runtimeToolRunVisibility.js';
import type { RuntimePluginUse } from './runtimePluginUsage.js';

/** Keep plugin records beside their source, splitting a tool group only at a usage boundary. */
export function interleaveRuntimePluginUses(
  segment: RuntimeMessage,
  body: AssistantWorkItem[],
  pluginUses: RuntimePluginUse[],
  includeUnanchored: boolean,
): AssistantWorkItem[] {
  const uses = pluginUses.filter((plugin) => plugin.anchor
    ? plugin.anchor.messageId === segment.id
    : includeUnanchored);
  const items: AssistantWorkItem[] = [];
  const appendPlugins = (placement: 'before' | 'after', toolRunId?: string) => {
    const plugins = uses.filter(({ anchor }) => (
      (anchor?.placement ?? 'before') === placement && anchor?.toolRunId === toolRunId
    ));
    if (plugins.length) items.push({
      type: 'pluginUses',
      id: `${segment.id}:plugins:${toolRunId ?? 'message'}:${placement}`,
      messageId: segment.id,
      plugins,
    });
  };

  appendPlugins('before');
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
    if (uses.some(({ anchor }) => anchor?.toolRunId === run.id)) {
      flushRuns();
      appendPlugins('before', run.id);
      if (!isTranscriptHiddenRuntimeToolRun(run)) runs.push(run);
      flushRuns();
      appendPlugins('after', run.id);
    } else if (!isTranscriptHiddenRuntimeToolRun(run)) {
      runs.push(run);
    }
  }
  flushRuns();
  appendPlugins('after');
  return items;
}
