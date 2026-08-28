import type { RuntimeToolRun } from '@setsuna-desktop/contracts';
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
  const segments = shellOutputSegments(shellResultPreviewForDisplay(run));
  const status = shellStatusLabel(run, t);
  const diagnostic = shellDiagnosticText(run);
  return (
    <div className={`chat-mcp-terminal chat-mcp-terminal--${shellTerminalStatus(run)}`}>
      <div className="chat-mcp-terminal__header">Shell</div>
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
  const exit = shellContentLine(run.resultPreview ?? '', /^exit:\s*(.+)$/im);
  if (exit && exit !== '0') return t('toolRun.shell.status.failed');
  return t('toolRun.shell.status.success');
}

export function shellTerminalStatus(run: RuntimeToolRun): string {
  if (run.status === 'success') {
    const exit = shellContentLine(run.resultPreview ?? '', /^exit:\s*(.+)$/im);
    return exit && exit !== '0' ? 'error' : 'completed';
  }
  if (run.status === 'pending_approval') return 'pending';
  if (run.status === 'cancelled') return 'cancelled';
  return run.status === 'error' || run.status === 'rejected'
    ? 'error'
    : run.status;
}

export function shellDiagnosticText(run: RuntimeToolRun): string {
  const content = run.resultPreview ?? '';
  const exit = shellContentLine(content, /^exit:\s*(.+)$/im);
  const cwd = shellContentLine(content, /^cwd:\s*(.+)$/im);
  return [
    exit ? `exit ${exit}` : '',
    cwd ? `cwd ${cwd}` : '',
  ].filter(Boolean).join(' · ');
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

  const segments: Array<{
    kind: 'stdout' | 'stderr' | 'message';
    text: string;
  }> = [];
  let active: 'stdout' | 'stderr' | 'message' | null = null;
  let buffer: string[] = [];
  const flush = () => {
    const text = normalizeShellStreamText(buffer.join('\n'));
    if (active && text) segments.push({ kind: active, text });
    buffer = [];
  };

  for (const line of normalized.split('\n')) {
    const stdout = /^stdout:\s*(.*)$/i.exec(line);
    if (stdout) {
      flush();
      active = 'stdout';
      if (stdout[1]) buffer.push(stdout[1]);
      continue;
    }
    const stderr = /^stderr:\s*(.*)$/i.exec(line);
    if (stderr) {
      flush();
      active = 'stderr';
      if (stderr[1]) buffer.push(stderr[1]);
      continue;
    }
    const error = /^error:\s*(.*)$/i.exec(line);
    if (error) {
      flush();
      active = 'stderr';
      if (error[1]) buffer.push(error[1]);
      continue;
    }
    if (shellMetadataLine(line)) continue;
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

export function shellMetadataLine(line: string): boolean {
  return (
    /^\$\s+/.test(line)
    || /^(cwd|exit|status):/i.test(line)
    || /^Process is still running\./.test(line)
    || /^Persisted until /.test(line)
  );
}
