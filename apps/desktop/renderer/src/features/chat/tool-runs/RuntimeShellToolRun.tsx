import type { RuntimeToolRun } from '@setsuna-desktop/contracts';
import { Info } from 'lucide-react';
import {
  translate,
  useI18n,
  type Translate,
} from '../../../shared/i18n/I18nProvider.js';
import {
  recordFromJson,
  stringField,
  toolRunTarget,
} from './runtimeToolRunPresentationUtils.js';

const defaultTranslate: Translate = (key, params) => translate('zh-CN', key, params);

export function ShellTerminalResult({ run }: { run: RuntimeToolRun }) {
  const { t } = useI18n();
  const command = shellCommand(run);
  const resultPreview = shellResultPreviewForDisplay(run);
  const segments = shellOutputSegments(resultPreview);
  const runtimeDetails = shellRuntimeDetailLines(resultPreview);
  const status = shellStatusLabel(run, t);
  const diagnostic = shellDiagnosticText(run);
  const runtimeDetailsLabel = t('toolRun.shell.runtimeDetails');
  return (
    <div className={`chat-mcp-terminal chat-mcp-terminal--${shellTerminalStatus(run)}`}>
      <div className="chat-mcp-terminal__header">Shell</div>
      {runtimeDetails.length ? (
        <details className="chat-mcp-terminal__metadata">
          <summary
            aria-label={runtimeDetailsLabel}
            className="chat-mcp-terminal__metadata-trigger"
            title={runtimeDetailsLabel}
          >
            <Info aria-hidden="true" size={14} strokeWidth={1.8} />
          </summary>
          <div className="chat-mcp-terminal__metadata-panel">
            <div className="chat-mcp-terminal__metadata-title">
              {runtimeDetailsLabel}
            </div>
            <pre>{runtimeDetails.join('\n')}</pre>
          </div>
        </details>
      ) : null}
      <div className="chat-mcp-terminal__body">
        <div className="chat-mcp-terminal__command">
          <span>$</span>
          <code>{command || 'shell'}</code>
        </div>
        {segments.length ? (
          <div className="chat-mcp-terminal__output">
            {segments.map((segment, index) => (
              <pre
                key={`${segment.kind}-${index}`}
                className={`chat-mcp-terminal__stream chat-mcp-terminal__stream--${segment.kind}`}
              >
                {segment.text}
              </pre>
            ))}
          </div>
        ) : null}
      </div>
      {run.status !== 'pending_approval'
        && run.status !== 'cancelled'
        && run.status !== 'rejected' ? (
        <div className="chat-mcp-terminal__footer">
          {diagnostic ? `${status} · ${diagnostic}` : status}
        </div>
      ) : null}
    </div>
  );
}

export function shellCommand(run: RuntimeToolRun): string {
  const args = recordFromJson(run.argumentsPreview);
  const content = run.resultPreview ?? '';
  return stringField(args.command ?? args.cmd)
    || shellContentLine(content, /^\$\s+(.+)$/m)
    || shellContentLine(content, /^command:\s*(.+)$/im)
    || toolRunTarget(run);
}

export function shellResultPreviewForDisplay(
  run: RuntimeToolRun,
): string | undefined {
  // Rejected and cancelled commands never ran. A retained automatic-review
  // denial may instead describe a command the user subsequently approved.
  if (run.status === 'rejected' || run.status === 'cancelled') return undefined;
  const preview = run.resultPreview ?? '';
  if (isApprovalMetadataPreview(run, preview)) return undefined;
  if (run.status !== 'pending_approval' && run.status !== 'running') {
    return run.resultPreview;
  }
  const showsSandboxFailure =
    /\bspawn\b[^\r\n]*\b(?:EPERM|EACCES)\b|\boperation not permitted\b|\bpermission denied\b|\bread-only file system\b/iu
      .test(preview);
  if (!showsSandboxFailure) return run.resultPreview;
  if (
    run.approvalRetryKind === 'sandbox_readable_root'
    || run.approvalRetryKind === 'sandbox_bypass'
  ) {
    return undefined;
  }

  // Older persisted approvals predate retryKind; recognize the stable retry
  // wording so upgrading does not expose a stale sandbox failure as output.
  const reason = run.approvalReason ?? '';
  const legacySandboxRetry = reason.startsWith('Sandbox denied ')
    && reason.includes('Approve retry without the OS sandbox.');
  return legacySandboxRetry ? undefined : run.resultPreview;
}

function isApprovalMetadataPreview(run: RuntimeToolRun, preview: string): boolean {
  const normalized = preview.trim();
  if (!normalized) return false;
  return [
    run.approvalMessage,
    run.approvalReviewAssessment?.rationale,
  ].some((value) => value?.trim() === normalized);
}

export function shellStatusLabel(
  run: RuntimeToolRun,
  t: Translate = defaultTranslate,
): string {
  if (run.status === 'running' || run.status === 'pending_approval') {
    return t('toolRun.shell.status.running');
  }
  if (run.status === 'error') return t('toolRun.shell.status.failed');
  if (run.status === 'cancelled') return t('toolRun.shell.status.cancelled');
  if (run.status === 'rejected') return t('toolRun.shell.status.rejected');
  const exit = shellExitCode(run.resultPreview ?? '');
  if (isFailedShellExit(exit)) return t('toolRun.shell.status.failed');
  return t('toolRun.shell.status.success');
}

export function shellTerminalStatus(run: RuntimeToolRun): string {
  if (run.status === 'success') {
    return isFailedShellExit(shellExitCode(run.resultPreview ?? ''))
      ? 'error'
      : 'completed';
  }
  if (run.status === 'pending_approval') return 'pending';
  if (run.status === 'cancelled') return 'cancelled';
  return run.status === 'error' || run.status === 'rejected'
    ? 'error'
    : run.status;
}

export function shellDiagnosticText(run: RuntimeToolRun): string {
  const content = run.resultPreview ?? '';
  const exit = shellExitCode(content);
  if (isFailedShellExit(exit)) return `exit ${exit}`;
  const signal = shellContentLine(content, /^signal:\s*(.+)$/im);
  return signal && signal !== '(none)' ? `signal ${signal}` : '';
}

export function shellContentLine(content: string, pattern: RegExp): string {
  return pattern.exec(content)?.[1]?.trim() ?? '';
}

export function shellOutputSegments(
  value: string | undefined,
): Array<{ kind: 'stdout' | 'stderr' | 'message'; text: string }> {
  const normalized = String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n\nProcess is still running\.[\s\S]*$/u, '')
    .trimEnd();
  if (!normalized) return [];
  const lines = normalized.split('\n');
  const hasRuntimePreamble = lines.some((line) => /^Process Id:\s*/i.test(line));

  const segments: Array<{
    kind: 'stdout' | 'stderr' | 'message';
    text: string;
  }> = [];
  let active: 'stdout' | 'stderr' | 'message' | null = null;
  let streamStarted = false;
  let buffer: string[] = [];
  const flush = () => {
    const text = normalizeShellStreamText(buffer.join('\n'));
    if (active && text) segments.push({ kind: active, text });
    buffer = [];
  };

  for (const line of lines) {
    const stdout = /^stdout:\s*(.*)$/i.exec(line);
    if (stdout) {
      flush();
      active = 'stdout';
      streamStarted = true;
      if (stdout[1]) buffer.push(stdout[1]);
      continue;
    }
    const stderr = /^stderr:\s*(.*)$/i.exec(line);
    if (stderr) {
      flush();
      active = 'stderr';
      streamStarted = true;
      if (stderr[1]) buffer.push(stderr[1]);
      continue;
    }
    const error = /^error:\s*(.*)$/i.exec(line);
    if (error) {
      flush();
      active = 'stderr';
      streamStarted = true;
      if (error[1]) buffer.push(error[1]);
      continue;
    }
    if (shellMetadataLine(line, streamStarted, hasRuntimePreamble)) continue;
    if (!active) active = 'message';
    buffer.push(line);
  }
  flush();
  return segments;
}

export function normalizeShellStreamText(value: string): string {
  const text = value.trimEnd();
  return !text || text.trim() === '(empty)' ? '' : text;
}

export function shellRuntimeDetailLines(value: string | undefined): string[] {
  const lines = String(value || '').replace(/\r\n/g, '\n').split('\n');
  const hasRuntimePreamble = lines.some((line) => /^Process Id:\s*/i.test(line));
  let streamStarted = false;
  const details: string[] = [];

  for (const line of lines) {
    if (/^(?:stdout|stderr|error):/i.test(line)) {
      streamStarted = true;
      continue;
    }
    if (legacyShellMetadataLine(line)) {
      details.push(line.trim());
      continue;
    }
    if (hasRuntimePreamble && !streamStarted && runtimeShellMetadataLine(line)) {
      details.push(line.trim());
    }
  }
  return details;
}

export function shellMetadataLine(
  line: string,
  streamStarted = false,
  hasRuntimePreamble = true,
): boolean {
  return (
    /^\$\s+/.test(line)
    || legacyShellMetadataLine(line)
    || (hasRuntimePreamble && !streamStarted && runtimeShellMetadataLine(line))
    || /^Process is still running\./.test(line)
    || /^Persisted until /.test(line)
  );
}

function legacyShellMetadataLine(line: string): boolean {
  return /^(?:cwd|exit):/i.test(line);
}

function runtimeShellMetadataLine(line: string): boolean {
  return /^(?:Process Id|Command|Directory|Status|Sandbox|Persisted|Expires At|Elapsed Ms|Exit Code|Signal):/i
    .test(line);
}

function shellExitCode(content: string): string {
  return shellContentLine(content, /^(?:exit|Exit Code):\s*(.+)$/im);
}

function isFailedShellExit(exit: string): boolean {
  return Boolean(exit && exit !== '0' && exit !== '(none)');
}
