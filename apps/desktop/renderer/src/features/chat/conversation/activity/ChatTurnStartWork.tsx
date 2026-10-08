import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import { RuntimePluginUses } from '../../plugin-usage/RuntimePluginUses.js';
import type { RuntimePluginUse } from '../../plugin-usage/runtimePluginUsage.js';
import { RuntimeHookRuns } from '../../tool-runs/RuntimeHookRunDetails.js';
import type { RuntimeHookUse } from './runtimeHookUsage.js';
import { ActiveWorkPlaceholder, WorkHistoryPanel } from '../ChatWorkHistory.js';

/** Keep pre-response activity visible even when a Hook stops the turn before sampling. */
export function ChatTurnStartWork({
  active,
  hookUses,
  pluginUses,
  segments,
}: {
  active: boolean;
  hookUses: RuntimeHookUse[];
  pluginUses: RuntimePluginUse[];
  segments: RuntimeMessage[];
}) {
  const records = <>
    <RuntimePluginUses plugins={pluginUses} />
    <RuntimeHookRuns runs={hookUses.map(({ run }) => run)} />
  </>;
  if (active) return <ActiveWorkPlaceholder segments={segments}>{records}</ActiveWorkPlaceholder>;
  return <WorkHistoryPanel active={false} defaultExpanded hasDetails>{records}</WorkHistoryPanel>;
}
