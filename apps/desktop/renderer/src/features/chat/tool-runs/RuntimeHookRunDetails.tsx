import type {
  RuntimeHookRun,
  RuntimeToolRun,
} from '@setsuna-desktop/contracts';
import {
  useI18n,
  type Translate,
} from '../../../shared/i18n/I18nProvider.js';
import {
  inspectionEntryKind,
  toolRunGroupKind,
  toolRunSummary,
  ToolRunSummaryTarget,
} from './RuntimeToolRunPresentation.js';

export function hasHookRuns(run: RuntimeToolRun): boolean {
  return Boolean(run.hookRuns?.length);
}

export function GroupedHookRunList({ runs }: { runs: RuntimeToolRun[] }) {
  const { t } = useI18n();
  const runsWithHooks = runs.filter(hasHookRuns);
  if (!runsWithHooks.length) return null;
  return (
    <div className="chat-tool-run__hook-groups">
      {runsWithHooks.map((run) => {
        const summary = toolRunSummary(run, t);
        const kind = toolRunGroupKind(run);
        return (
          <div className="chat-tool-run__hook-group" key={`${run.id}:hooks`}>
            <div className="chat-tool-run__hook-group-title">
              <span>{summary.title}</span>
              <ToolRunSummaryTarget
                inspectionKind={
                  kind === 'inspection' ? inspectionEntryKind(run) : undefined
                }
                kind={kind}
                target={summary.target}
              />
            </div>
            <HookRunList runs={run.hookRuns} />
          </div>
        );
      })}
    </div>
  );
}

export function HookRunList({ runs }: { runs?: RuntimeHookRun[] }) {
  const { t } = useI18n();
  if (!runs?.length) return null;
  return (
    <div className="chat-tool-run__hooks">
      {runs.map((run) => (
        <div
          className={`chat-tool-run__hook chat-tool-run__hook--${run.status}`}
          key={run.id}
        >
          <span className="chat-tool-run__hook-dot" />
          <span className="chat-tool-run__hook-main">
            <span className="chat-tool-run__hook-title">
              {hookRunTitle(run, t)}
            </span>
            {run.message
              ? <span className="chat-tool-run__hook-message">{run.message}</span>
              : null}
            <HookOutputEntryList entries={run.entries} />
          </span>
          {hookRunStatusText(run.status, t) ? (
            <span className="chat-tool-run__hook-status">
              {hookRunStatusText(run.status, t)}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function HookOutputEntryList({
  entries,
}: {
  entries?: RuntimeHookRun['entries'];
}) {
  const { t } = useI18n();
  if (!entries?.length) return null;
  return (
    <span className="chat-tool-run__hook-entries">
      {entries.map((entry, index) => (
        <span
          className={`chat-tool-run__hook-entry chat-tool-run__hook-entry--${entry.kind}`}
          key={`${entry.kind}:${index}`}
        >
          {hookOutputEntryLabel(entry.kind, t)} {entry.text}
        </span>
      ))}
    </span>
  );
}

function hookOutputEntryLabel(
  kind: NonNullable<RuntimeHookRun['entries']>[number]['kind'],
  t: Translate,
): string {
  if (kind === 'warning') return t('toolRun.hook.output.warning');
  if (kind === 'stop') return t('toolRun.hook.output.stop');
  if (kind === 'feedback') return t('toolRun.hook.output.feedback');
  if (kind === 'context') return t('toolRun.hook.output.context');
  return t('toolRun.hook.output.error');
}

function hookRunTitle(run: RuntimeHookRun, t: Translate): string {
  const label = hookEventLabel(run.eventName, t);
  if (run.statusMessage) return `${label}：${run.statusMessage}`;
  if (run.matcher) return `${label} · ${run.matcher}`;
  return label;
}

function hookEventLabel(
  eventName: RuntimeHookRun['eventName'],
  t: Translate,
): string {
  if (eventName === 'PreToolUse') return t('toolRun.hook.event.preToolUse');
  if (eventName === 'PermissionRequest') {
    return t('toolRun.hook.event.permissionRequest');
  }
  if (eventName === 'PostToolUse') return t('toolRun.hook.event.postToolUse');
  if (eventName === 'PreCompact') return t('toolRun.hook.event.preCompact');
  if (eventName === 'PostCompact') return t('toolRun.hook.event.postCompact');
  if (eventName === 'SessionStart') return t('toolRun.hook.event.sessionStart');
  if (eventName === 'SubagentStart') return t('toolRun.hook.event.subagentStart');
  if (eventName === 'UserPromptSubmit') {
    return t('toolRun.hook.event.userPromptSubmit');
  }
  if (eventName === 'SubagentStop') return t('toolRun.hook.event.subagentStop');
  if (eventName === 'Stop') return t('toolRun.hook.event.stop');
  return 'hook';
}

function hookRunStatusText(
  status: RuntimeHookRun['status'],
  t: Translate,
): string {
  if (status === 'running') return t('toolRun.hook.status.running');
  if (status === 'blocked') return t('toolRun.hook.status.blocked');
  if (status === 'stopped') return t('toolRun.hook.status.stopped');
  if (status === 'failed') return t('toolRun.hook.status.failed');
  return '';
}
