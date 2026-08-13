import type { RuntimeToolRun } from '@setsuna-desktop/contracts';
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  FileText,
  Pencil,
  Play,
  Search,
  ShieldAlert,
  TerminalSquare,
  Wrench,
  XCircle,
} from 'lucide-react';
import {
  translate,
  useI18n,
  type Translate,
} from '../../../shared/i18n/I18nProvider.js';
import type { ToolRunGroupKind } from './runtime-tool-run-types.js';
import { isRuntimeFileMutationRun } from './runtimeFileChanges.js';

const defaultTranslate: Translate = (key, params) => translate('zh-CN', key, params);

export function ToolRunStatus({
  status,
  summaryTitle,
}: {
  status: RuntimeToolRun['status'];
  summaryTitle?: string;
}) {
  const { t } = useI18n();
  const text = statusTextFromStatus(status, summaryTitle, t);
  return text ? <span className="chat-tool-run__status">{text}</span> : null;
}

export function statusTextFromStatus(
  status: RuntimeToolRun['status'],
  summaryTitle = '',
  t: Translate = defaultTranslate,
) {
  if (status === 'pending_approval') {
    const title = summaryTitle.trim();
    return title.startsWith(t('toolRun.status.awaitingPrefix'))
      || title.startsWith(t('toolRun.approvalReview.pending'))
      ? ''
      : t('toolRun.status.confirm');
  }
  if (status === 'cancelled') return t('toolRun.status.cancelled');
  if (status === 'rejected') return t('toolRun.status.rejected');
  if (status === 'error') return t('toolRun.status.failed');
  return '';
}

export function toolRunGroupIcon(
  kind: ToolRunGroupKind,
  status: RuntimeToolRun['status'],
) {
  if (status === 'pending_approval') return <ShieldAlert size={14} />;
  if (status === 'running') return <Clock3 size={14} />;
  if (status === 'error' || status === 'cancelled') return <XCircle size={14} />;
  if (status === 'rejected') return <AlertCircle size={14} />;
  return toolRunKindIcon(kind);
}

export function mixedToolRunGroupIcon(status: RuntimeToolRun['status']) {
  if (status === 'pending_approval') return <ShieldAlert size={14} />;
  if (status === 'running') return <Clock3 size={14} />;
  if (status === 'cancelled') return <XCircle size={14} />;
  if (status === 'rejected') return <AlertCircle size={14} />;
  return <CheckCircle2 size={14} />;
}

export function toolRunIcon(run: RuntimeToolRun) {
  if (run.status === 'pending_approval') return <ShieldAlert size={14} />;
  if (run.status === 'running') return <Clock3 size={14} />;
  if (run.status === 'error' || run.status === 'cancelled') return <XCircle size={14} />;
  if (run.status === 'rejected') return <AlertCircle size={14} />;
  if (run.name.includes('search')) return <Search size={14} />;
  if (run.name.includes('shell')) return <TerminalSquare size={14} />;
  if (isRuntimeFileMutationRun(run)) return <Pencil size={14} />;
  if (run.name.includes('file') || run.name.includes('workspace')) return <FileText size={14} />;
  if (run.name.includes('run')) return <Play size={14} />;
  if (run.status === 'success') return <CheckCircle2 size={14} />;
  return <Wrench size={14} />;
}

export function toolRunKindIcon(kind: ToolRunGroupKind) {
  if (kind === 'inspection') return <FileText size={14} />;
  if (kind === 'search') return <Search size={14} />;
  if (kind === 'shell') return <TerminalSquare size={14} />;
  if (kind === 'fileMutation') return <Pencil size={14} />;
  return <CheckCircle2 size={14} />;
}
