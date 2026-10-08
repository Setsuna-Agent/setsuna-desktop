import type { RuntimeHookRun } from '@setsuna-desktop/contracts';
import { CheckCircle2, ChevronDown, CircleAlert, CircleStop, Grip } from 'lucide-react';
import { useI18n, type Translate } from '../../../shared/i18n/I18nProvider.js';
import { ToolPreview } from './ToolPreview.js';

/** Hook calls use the same compact, expandable activity rows as tool calls. */
export function RuntimeHookRuns({ runs }: { runs?: RuntimeHookRun[] }) {
  if (!runs?.length) return null;
  return (
    <div className="chat-tool-runs">
      {runs.map((run) => <HookRunRecord key={run.id} run={run} />)}
    </div>
  );
}

function HookRunRecord({ run }: { run: RuntimeHookRun }) {
  const { t } = useI18n();
  const status = run.status === 'completed' ? 'success'
    : run.status === 'failed' || run.status === 'blocked' ? 'error'
      : run.status === 'stopped' ? 'cancelled' : 'running';
  const Icon = status === 'running' ? Grip : status === 'error' ? CircleAlert
    : status === 'cancelled' ? CircleStop : CheckCircle2;
  // Output is diagnostic content, never a Hook's display name.
  const name = run.statusMessage?.trim() || [run.pluginId, run.eventName, run.matcher].filter(Boolean).join(' · ');
  const statusText = hookRunStatusText(run.status, t);
  return (
    <details className={`chat-tool-run chat-tool-run--${status}`}>
      <summary className="chat-tool-run__summary" title={statusText || undefined}>
        <span className="chat-tool-run__icon"><Icon aria-hidden="true" size={14} /></span>
        <span className="chat-tool-run__summary-text">
          <span className="chat-tool-run__title">{t(run.status === 'running' ? 'toolRun.hook.calling' : 'toolRun.hook.called')}</span>
          <span className="chat-tool-run__target" title={name}>{name}</span>
        </span>
        {statusText ? <span className="chat-tool-run__status">{statusText}</span> : null}
        <ChevronDown aria-hidden="true" className="chat-tool-run__chevron" size={12} />
      </summary>
      <div className="chat-tool-run__body">
        <ToolPreview label="Hook" value={run.eventName} />
        {run.command ? <ToolPreview code label={t('toolRun.shell.metadata.command')} value={run.command} /> : null}
        {run.message ? <ToolPreview label={t('toolRun.hook.output.feedback')} value={run.message} /> : null}
        {run.entries?.map((entry, index) => (
          <ToolPreview key={`${entry.kind}:${index}`} label={hookOutputEntryLabel(entry.kind, t)} value={entry.text} />
        ))}
        {run.stdoutPreview ? <ToolPreview code label="stdout" value={run.stdoutPreview} /> : null}
        {run.stderrPreview ? <ToolPreview code label="stderr" value={run.stderrPreview} /> : null}
      </div>
    </details>
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
