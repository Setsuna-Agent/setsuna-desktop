import type { RuntimePluginReference, RuntimeToolRun } from '@setsuna-desktop/contracts';
import {
  FileText,
  MessageCircleQuestion,
  Search,
  SquareTerminal,
  Wrench,
} from 'lucide-react';
import {
  translate,
  useI18n,
  type Translate,
} from '../../../shared/i18n/I18nProvider.js';
import { EditIcon } from '../../../shared/ui/EditIcon.js';
import { PluginIcon } from '../../../shared/ui/PluginIcon.js';
import { usePluginReferenceCatalog } from '../references/PluginReference.js';
import type { ToolRunGroupKind } from './runtime-tool-run-types.js';
import { toolRunGroupKind } from './runtimeToolRunGrouping.js';

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
      || title === t('toolRun.input.asking')
      ? ''
      : t('toolRun.status.confirm');
  }
  if (status === 'cancelled') {
    const cancelledLabel = t('toolRun.status.cancelled');
    return summaryTitle.includes(cancelledLabel) ? '' : cancelledLabel;
  }
  if (status === 'rejected') {
    const rejectedLabel = t('toolRun.status.rejected');
    return summaryTitle.includes(rejectedLabel) ? '' : rejectedLabel;
  }
  return '';
}

export function toolRunGroupIcon(
  kind: ToolRunGroupKind,
  plugin?: RuntimePluginReference,
) {
  if (plugin) return <ToolRunPluginIcon plugin={plugin} />;
  return toolRunKindIcon(kind);
}

export function toolRunIcon(run: RuntimeToolRun) {
  // The leading icon identifies the activity, independently of its outcome.
  if (run.userInput) return <MessageCircleQuestion size={14} />;
  if (run.plugin) return <ToolRunPluginIcon plugin={run.plugin} />;
  const kind = toolRunGroupKind(run);
  if (kind !== 'generic') return toolRunKindIcon(kind);
  if (run.name.includes('search')) return <Search size={14} />;
  if (run.name.includes('file') || run.name.includes('workspace')) return <FileText size={14} />;
  return <Wrench size={14} />;
}

function ToolRunPluginIcon({ plugin }: { plugin: RuntimePluginReference }) {
  const installed = usePluginReferenceCatalog().find((item) => item.id === plugin.id);
  return (
    <PluginIcon
      className="chat-work-history__plugin-icon"
      name={installed?.icon ?? plugin.icon}
      iconImage={installed?.iconImage}
      pluginId={plugin.id}
      variant="inline"
    />
  );
}

export function toolRunKindIcon(kind: ToolRunGroupKind) {
  if (kind === 'inspection') return <FileText size={14} />;
  if (kind === 'search') return <Search size={14} />;
  if (kind === 'shell') return <SquareTerminal size={14} />;
  if (kind === 'fileMutation') return <EditIcon size={14} />;
  return <Wrench size={14} />;
}
