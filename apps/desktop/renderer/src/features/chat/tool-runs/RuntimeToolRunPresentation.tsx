import {
  PUBLISH_ARTIFACT_TOOL_NAME,
  type RuntimeToolRun
} from '@setsuna-desktop/contracts';
import { FileText, Search, TerminalSquare } from 'lucide-react';
import { translate, useI18n, type Translate } from '../../../shared/i18n/I18nProvider.js';
import { WorkspaceFileLink, WorkspacePathLabel } from '../markdown/WorkspaceFileLink.js';
import { collaborationGroupSummary } from './runtimeCollaborationRuns.js';
import type {
  ToolRunDisplayGroup,
  ToolRunGroup,
  ToolRunGroupKind,
  ToolRunSummaryMode,
} from './runtime-tool-run-types.js';
import {
  fileOperationChangeTotals,
} from './runtimeToolRunChangeCounts.js';
import {
  compactUrlTarget,
  isPreparingToolRun,
  isRecord,
  isWebContentRun,
  recordFromJson,
  stringField,
  toolRunTarget,
} from './runtimeToolRunPresentationUtils.js';
import {
  isAutomaticApprovalReviewPending,
  isPendingRuntimeToolApproval,
} from './runtimeToolRunState.js';
import {
  activeToolRunOrLast,
  toolRunGroupKind,
  toolRunGroupingKey,
  toolRunGroupStatus,
} from './runtimeToolRunGrouping.js';
import {
  shellCommand,
} from './RuntimeShellToolRun.js';
import {
  fileChangeFromToolRun,
  fileChangesFromToolRun,
  fileMutationDisplayPath,
  isRuntimeFileMutationRun
} from './runtimeFileChanges.js';

const defaultTranslate: Translate = (key, params) => translate('zh-CN', key, params);

export {
  fileMutationChangeTotals,
  fileOperationChangeTotals,
  fileOperationChangeTotalsFromArguments,
  fileOperationDiffTotalsFromValue,
} from './runtimeToolRunChangeCounts.js';
export {
  compactUrlTarget,
  concisePreview,
  countTextLines,
  formatPreview,
  genericToolRunDiagnostic,
  isPreparingToolRun,
  isRecord,
  isWebContentRun,
  optionalNumber,
  recordFromJson,
  stringField,
  toolRunTarget,
} from './runtimeToolRunPresentationUtils.js';
export {
  normalizeShellStreamText,
  shellCommand,
  shellContentLine,
  shellDiagnosticText,
  shellMetadataLine,
  shellOutputSegments,
  shellResultPreviewForDisplay,
  shellStatusLabel,
  ShellTerminalResult,
  shellTerminalStatus,
} from './RuntimeShellToolRun.js';
export {
  mixedToolRunGroupIcon,
  statusTextFromStatus,
  ToolRunStatus,
  toolRunGroupIcon,
  toolRunIcon,
  toolRunKindIcon,
} from './RuntimeToolRunStatus.js';
export {
  activeToolRunOrLast,
  toolRunGroupKind,
  toolRunGroupingKey,
  toolRunGroupStatus,
} from './runtimeToolRunGrouping.js';

export function fileOperationGroupChangeTotals(runs: RuntimeToolRun[]): { additions: number; deletions: number; showZero: boolean } | null {
  let hasTotals = false;
  let showZero = false;
  let additions = 0;
  let deletions = 0;
  for (const entry of fileOperationStableChangeEntries(runs)) {
    if (!entry.hasChangeCounts) continue;
    hasTotals = true;
    showZero = showZero || entry.showZeroChangeCounts === true;
    additions += entry.additions ?? 0;
    deletions += entry.deletions ?? 0;
  }
  if (hasTotals) return { additions, deletions, showZero: showZero || additions !== 0 || deletions !== 0 };
  return null;
}

export function fileOperationStableChangeEntries(runs: RuntimeToolRun[]): FileOperationEntry[] {
  // A preparing run contains a streamed preview, not an applied change. Keep
  // stable counts from the other runs instead of hiding the whole group.
  return fileOperationEntries(runs.filter((run) => !isPreparingToolRun(run)));
}

export function groupToolRuns(runs: RuntimeToolRun[]): ToolRunGroup[] {
  const groups: ToolRunGroup[] = [];
  let bucket: RuntimeToolRun[] = [];
  let bucketKey = '';
  let bucketKind: ToolRunGroupKind = 'generic';

  const flush = () => {
    if (!bucket.length) return;
    if (bucket.length === 1) {
      groups.push({ type: 'single', run: bucket[0] });
    } else {
      groups.push({
        type: 'group',
        id: `${bucketKind}:${bucket.map((run) => run.id).join(':')}`,
        kind: bucketKind,
        runs: bucket,
      });
    }
    bucket = [];
  };

  for (const run of runs) {
    const kind = toolRunGroupKind(run);
    const key = toolRunGroupingKey(run);
    if (bucket.length && key !== bucketKey) flush();
    bucket.push(run);
    bucketKey = key;
    bucketKind = kind;
  }
  flush();
  return groups;
}

export function compactToolRunGroups(groups: ToolRunGroup[], summaryMode: ToolRunSummaryMode): ToolRunDisplayGroup[] {
  return groups.length > 1
    ? [{ type: 'mixed', id: `mixed:${groups.map(toolRunGroupId).join(':')}`, groups, summaryMode }]
    : groups;
}

export function toolRunGroupId(group: ToolRunGroup): string {
  return group.type === 'single' ? group.run.id : group.id;
}

export function toolRunGroupRuns(group: ToolRunGroup): RuntimeToolRun[] {
  return group.type === 'single' ? [group.run] : group.runs;
}

export function toolRunDisplayStableKey(group: ToolRunGroup): string {
  return toolRunGroupRuns(group)[0]?.id ?? toolRunGroupId(group);
}

export type CompactToolRunSummary = {
  title: string;
  target?: string;
  targetKind?: ToolRunGroupKind;
  inspectionKind?: InspectionEntryKind;
  changeCounts?: { additions: number; deletions: number; showZero: boolean };
};

export function mixedToolRunGroupSummary(
  groups: ToolRunGroup[],
  summaryMode: ToolRunSummaryMode,
  t: Translate = defaultTranslate,
): CompactToolRunSummary {
  const reviewingRun = groups
    .flatMap(toolRunGroupRuns)
    .find(isAutomaticApprovalReviewPending);
  if (reviewingRun) {
    const kind = toolRunGroupKind(reviewingRun);
    return {
      ...toolRunSummary(reviewingRun, t),
      targetKind: kind,
      inspectionKind: kind === 'inspection' ? inspectionEntryKind(reviewingRun) : undefined,
    };
  }
  if (summaryMode === 'latest') return compactToolRunGroupSummary(groups.at(-1), t);
  return { title: mixedToolRunGroupAggregateTitle(groups, t) };
}

export function compactToolRunGroupSummary(group: ToolRunGroup | undefined, t: Translate = defaultTranslate): CompactToolRunSummary {
  if (!group) return { title: '' };
  const runs = toolRunGroupRuns(group);
  const kind = group.type === 'single' ? toolRunGroupKind(group.run) : group.kind;
  if (kind === 'fileMutation') return { ...fileOperationGroupSummary(runs, t), targetKind: kind };
  if (group.type === 'single') {
    return {
      ...toolRunSummary(group.run, t),
      targetKind: kind,
      inspectionKind: kind === 'inspection' ? inspectionEntryKind(group.run) : undefined,
    };
  }
  if (kind === 'shell' && runs.length === 1) return { ...toolRunSummary(runs[0], t), targetKind: kind };
  return { title: mixedToolRunGroupPart(group, t) };
}

export function mixedToolRunGroupAggregateTitle(groups: ToolRunGroup[], t: Translate = defaultTranslate): string {
  const buckets: Array<{ key: string; kind: ToolRunGroupKind | 'webContent'; runs: RuntimeToolRun[] }> = [];
  const bucketByKey = new Map<string, { key: string; kind: ToolRunGroupKind | 'webContent'; runs: RuntimeToolRun[] }>();

  for (const group of groups) {
    const runs = toolRunGroupRuns(group);
    const kind = group.type === 'single' ? toolRunGroupKind(group.run) : group.kind;
    const webContent = kind === 'generic' && webContentGroupSummary(runs, t);
    const key = webContent ? 'webContent' : kind === 'generic' ? `generic:${runs[0]?.name ?? 'tool'}` : kind;
    const bucketKind = webContent ? 'webContent' : kind;
    let bucket = bucketByKey.get(key);
    if (!bucket) {
      bucket = { key, kind: bucketKind, runs: [] };
      bucketByKey.set(key, bucket);
      buckets.push(bucket);
    }
    bucket.runs.push(...runs);
  }

  return buckets
    .map((bucket) => mixedToolRunBucketSummary(bucket.kind, bucket.runs, t))
    .filter(Boolean)
    .join(t('toolRun.joiner'));
}

export function mixedToolRunBucketSummary(
  kind: ToolRunGroupKind | 'webContent',
  runs: RuntimeToolRun[],
  t: Translate = defaultTranslate,
): string {
  const status = toolRunGroupStatus(runs);
  if (kind === 'fileMutation') return fileOperationAggregateTitle(runs, t);
  if (kind === 'collaboration') return collaborationGroupSummary(runs, t);
  if (kind === 'inspection') {
    const parts = inspectionSummaryParts(inspectionEntries(runs), t);
    return parts.length ? parts.join(t('toolRun.joiner')) : inspectionGroupSummary(runs, t).title;
  }
  if (kind === 'shell') return shellCountSummary(runs, status, t);
  if (kind === 'search') return searchCountSummary(runs, status, t);
  if (kind === 'webContent') return webContentGroupSummary(runs, t)?.title ?? '';
  const name = runs[0]
    ? toolRunDisplayName(runs[0], t)
    : t('toolRun.tool');
  if (status === 'running' || status === 'pending_approval') return t('toolRun.generic.running', { name });
  if (status === 'cancelled') return t('toolRun.generic.cancelled', { name });
  if (status === 'rejected') return t('toolRun.generic.rejected', { name });
  return t('toolRun.generic.used', { count: runs.length, name });
}

export function mixedToolRunGroupPart(group: ToolRunGroup, t: Translate = defaultTranslate): string {
  const runs = toolRunGroupRuns(group);
  const kind = group.type === 'single' ? toolRunGroupKind(group.run) : group.kind;
  const status = toolRunGroupStatus(runs);
  if (kind === 'fileMutation') return fileOperationAggregateTitle(runs, t);
  if (kind === 'collaboration') return collaborationGroupSummary(runs, t);
  if (kind === 'shell') return shellCountSummary(runs, status, t);
  if (kind === 'inspection') return inspectionGroupSummary(runs, t).title;
  if (kind === 'search') return searchCountSummary(runs, status, t);
  const webContentSummary = webContentGroupSummary(runs, t);
  if (webContentSummary) return webContentSummary.title;
  const name = runs[0]
    ? toolRunDisplayName(runs[0], t)
    : t('toolRun.tool');
  if (status === 'running' || status === 'pending_approval') return t('toolRun.generic.running', { name });
  if (status === 'cancelled') return t('toolRun.generic.cancelled', { name });
  if (status === 'rejected') return t('toolRun.generic.rejected', { name });
  return t('toolRun.generic.used', { count: runs.length, name });
}

export function shellCountSummary(runs: RuntimeToolRun[], status: RuntimeToolRun['status'], t: Translate = defaultTranslate): string {
  if (status === 'running' || status === 'pending_approval') return t('toolRun.shell.runningCount', { count: runs.length });
  if (status === 'cancelled') return t('toolRun.shell.cancelledCount', { count: runs.length });
  if (status === 'rejected') return t('toolRun.shell.rejectedCount', { count: runs.length });
  return t('toolRun.shell.completedCount', { count: runs.length });
}

export function searchCountSummary(runs: RuntimeToolRun[], status: RuntimeToolRun['status'], t: Translate = defaultTranslate): string {
  if (status === 'running' || status === 'pending_approval') return t('toolRun.search.runningCount', { count: runs.length });
  if (status === 'cancelled') return t('toolRun.search.cancelledCount', { count: runs.length });
  if (status === 'rejected') return t('toolRun.search.rejectedCount', { count: runs.length });
  return t('toolRun.search.completedCount', { count: runs.length });
}

export function isShellRun(run: RuntimeToolRun): boolean {
  return toolRunGroupKind(run) === 'shell';
}

export function isFileOperationRun(run: RuntimeToolRun): boolean {
  return isRuntimeFileMutationRun(run);
}

export function isPendingApprovalRun(run: RuntimeToolRun): boolean {
  return isPendingRuntimeToolApproval(run);
}

export function pendingApprovalDisclosureKey(runs: RuntimeToolRun[]): string | undefined {
  const pendingApprovalIds = runs
    .filter(isPendingApprovalRun)
    .map((run) => run.approvalId ?? run.id);
  return pendingApprovalIds.length ? pendingApprovalIds.join(':') : undefined;
}

export function isFlatInspectionRun(run: RuntimeToolRun): boolean {
  return toolRunGroupKind(run) === 'inspection' && run.status !== 'pending_approval';
}

export function toolRunGroupSummary(
  group: Extract<ToolRunGroup, { type: 'group' }>,
  t: Translate = defaultTranslate,
): { title: string; target?: string } {
  const reviewingRun = group.runs.find(isAutomaticApprovalReviewPending);
  if (reviewingRun) return toolRunSummary(reviewingRun, t);
  if (group.kind === 'inspection') return inspectionGroupSummary(group.runs, t);
  if (group.kind === 'shell') return shellGroupSummary(group.runs, t);
  if (group.kind === 'search') return searchGroupSummary(group.runs, t);
  if (group.kind === 'fileMutation') return fileOperationGroupSummary(group.runs, t);
  const webContentSummary = webContentGroupSummary(group.runs, t);
  if (webContentSummary) return webContentSummary;
  const status = toolRunGroupStatus(group.runs);
  const name = group.runs[0]
    ? toolRunDisplayName(group.runs[0], t)
    : t('toolRun.tool');
  if (status === 'running' || status === 'pending_approval') return { title: t('toolRun.generic.running', { name }) };
  if (status === 'error') return { title: t('toolRun.generic.failed', { name }) };
  if (status === 'cancelled') return { title: t('toolRun.generic.cancelled', { name }) };
  if (status === 'rejected') return { title: t('toolRun.generic.rejected', { name }) };
  return { title: t('toolRun.generic.used', { count: group.runs.length, name }) };
}

export function inspectionGroupSummary(runs: RuntimeToolRun[], t: Translate = defaultTranslate): { title: string; target?: string } {
  const status = toolRunGroupStatus(runs);
  const active = activeToolRunOrLast(runs);
  const activeEntry = active ? inspectionEntryFromRun(active) : null;
  const activeTarget = activeEntry?.target ?? '';
  if (status === 'running' || status === 'pending_approval') {
    return {
      title: active && isPreparingToolRun(active)
        ? t('toolRun.inspection.preparing')
        : activeEntry ? inspectionRunningTitle(activeEntry.kind, t) : t('toolRun.inspection.running'),
      target: activeTarget,
    };
  }
  if (status === 'error') return { title: t('toolRun.inspection.failed'), target: activeTarget };
  if (status === 'cancelled') return { title: t('toolRun.inspection.cancelled'), target: activeTarget };
  if (status === 'rejected') return { title: t('toolRun.inspection.rejected'), target: activeTarget };
  const parts = inspectionSummaryParts(inspectionEntries(runs), t);
  if (parts.length) return { title: parts.join(t('toolRun.joiner')) };
  return { title: activeEntry ? inspectionCompleteTitle(activeEntry.kind, t) : t('toolRun.inspection.completed'), target: activeTarget };
}

export function shellGroupSummary(runs: RuntimeToolRun[], t: Translate = defaultTranslate): { title: string; target?: string } {
  const status = toolRunGroupStatus(runs);
  const active = activeToolRunOrLast(runs);
  const command = active ? shellCommand(active) : '';
  if (status === 'running' || status === 'pending_approval') {
    if (active && isPreparingToolRun(active)) return { title: command ? t('toolRun.shell.preparingCommand', { command }) : t('toolRun.shell.generatingCommand') };
    return { title: command ? t('toolRun.shell.runningCommand', { command }) : t('toolRun.shell.running') };
  }
  if (status === 'error') return { title: command ? t('toolRun.shell.failedCommand', { command }) : t('toolRun.shell.failed') };
  if (status === 'cancelled') return { title: command ? t('toolRun.shell.cancelledCommand', { command }) : t('toolRun.shell.cancelled') };
  if (status === 'rejected') return { title: command ? t('toolRun.shell.rejectedCommand', { command }) : t('toolRun.shell.rejected') };
  return { title: t('toolRun.shell.completedCount', { count: runs.length }) };
}

export function searchGroupSummary(runs: RuntimeToolRun[], t: Translate = defaultTranslate): { title: string; target?: string } {
  const status = toolRunGroupStatus(runs);
  const active = activeToolRunOrLast(runs);
  const query = active ? toolRunTarget(active) : '';
  if (status === 'running' || status === 'pending_approval') return { title: t(active && isPreparingToolRun(active) ? 'toolRun.search.preparing' : 'toolRun.search.running'), target: query };
  if (status === 'error') return { title: t('toolRun.search.failed'), target: query };
  if (status === 'cancelled') return { title: t('toolRun.search.cancelled'), target: query };
  if (status === 'rejected') return { title: t('toolRun.search.rejected'), target: query };
  if (runs.length > 1) return { title: t('toolRun.search.completedCount', { count: runs.length }) };
  return { title: t('toolRun.search.completed'), target: query };
}

export function webContentGroupSummary(runs: RuntimeToolRun[], t: Translate = defaultTranslate): { title: string; target?: string } | null {
  if (!runs.length || runs.some((run) => !isWebContentRun(run))) return null;
  const status = toolRunGroupStatus(runs);
  const active = activeToolRunOrLast(runs);
  const target = active ? toolRunTarget(active) : '';
  if (status === 'running' || status === 'pending_approval') return { title: t(active && isPreparingToolRun(active) ? 'toolRun.web.preparing' : 'toolRun.web.running'), target };
  if (status === 'error') return { title: t('toolRun.web.failed'), target };
  if (status === 'cancelled') return { title: t('toolRun.web.cancelled'), target };
  if (status === 'rejected') return { title: t('toolRun.web.rejected'), target };
  if (runs.length > 1) return { title: t('toolRun.web.completedCount', { count: runs.length }) };
  return { title: t('toolRun.web.completed'), target };
}

export type InspectionEntryKind = 'file' | 'directory' | 'fileSearch' | 'gitStatus';
export type InspectionEntry = { target: string; kind: InspectionEntryKind };

export function inspectionEntries(runs: RuntimeToolRun[]): InspectionEntry[] {
  const entries = new Map<string, InspectionEntry>();
  for (const run of runs) {
    const entry = inspectionEntryFromRun(run);
    if (!entry) continue;
    const key = `${entry.kind}:${entry.target}`;
    if (!entries.has(key)) entries.set(key, entry);
  }
  return [...entries.values()];
}

export function inspectionEntryFromRun(run: RuntimeToolRun): InspectionEntry | null {
  const target = toolRunTarget(run) || (run.name === 'workspace_list_directory' || run.name === 'list_directory' || run.name === 'git_status' ? '.' : '');
  if (!target) return null;
  return {
    target,
    kind: inspectionEntryKind(run),
  };
}

export function inspectionEntryKind(run: RuntimeToolRun): InspectionEntryKind {
  if (run.name === 'workspace_list_directory' || run.name === 'list_directory') return 'directory';
  if (run.name === 'find_files') return 'fileSearch';
  if (run.name === 'git_status') return 'gitStatus';
  return 'file';
}

export function inspectionSummaryParts(entries: InspectionEntry[], t: Translate = defaultTranslate): string[] {
  const counts = new Map<InspectionEntryKind, number>();
  const order: InspectionEntryKind[] = [];
  for (const entry of entries) {
    if (!counts.has(entry.kind)) order.push(entry.kind);
    counts.set(entry.kind, (counts.get(entry.kind) ?? 0) + 1);
  }
  return order.map((kind) => inspectionSummaryPart(kind, counts.get(kind) ?? 0, t)).filter(Boolean);
}

export function inspectionSummaryPart(kind: InspectionEntryKind, count: number, t: Translate = defaultTranslate): string {
  if (kind === 'directory') return t('toolRun.inspection.directories', { count });
  if (kind === 'fileSearch') return t('toolRun.inspection.fileSearches', { count });
  if (kind === 'gitStatus') return t('toolRun.inspection.gitStatus');
  return t('toolRun.inspection.files', { count });
}

export function inspectionEntryLabel(kind: InspectionEntryKind, t: Translate = defaultTranslate): string {
  if (kind === 'directory') return t('toolRun.inspection.directoryLabel');
  if (kind === 'fileSearch') return t('toolRun.inspection.fileSearchLabel');
  if (kind === 'gitStatus') return t('toolRun.inspection.statusLabel');
  return t('toolRun.inspection.fileLabel');
}

export function inspectionRunningTitle(kind: InspectionEntryKind, t: Translate = defaultTranslate): string {
  if (kind === 'directory') return t('toolRun.inspection.directoryRunning');
  if (kind === 'fileSearch') return t('toolRun.inspection.fileSearchRunning');
  if (kind === 'gitStatus') return t('toolRun.inspection.gitStatusRunning');
  return t('toolRun.inspection.fileRunning');
}

export function inspectionCompleteTitle(kind: InspectionEntryKind, t: Translate = defaultTranslate): string {
  if (kind === 'directory') return t('toolRun.inspection.directoryLabel');
  if (kind === 'fileSearch') return t('toolRun.inspection.fileSearchLabel');
  if (kind === 'gitStatus') return t('toolRun.inspection.gitStatus');
  return t('toolRun.inspection.fileLabel');
}

export function fileOperationTarget(run: RuntimeToolRun, t: Translate = defaultTranslate): string {
  const args = recordFromJson(run.argumentsPreview);
  if (hasIncompleteFileOperationPath(args)) return '';
  return fileMutationDisplayPath(run, t) || fileOperationTargetFromArguments(run, t) || toolRunTarget(run) || fileMutationPathFromReason(run.approvalReason);
}

export function hasIncompleteFileOperationPath(args: Record<string, unknown>): boolean {
  return [
    ['path', 'path_closed'],
    ['file_path', 'file_path_closed'],
    ['target_path', 'target_path_closed'],
    ['file', 'file_closed'],
  ].some(([pathKey, closedKey]) => Boolean(stringField(args[pathKey])) && args[closedKey] === false);
}

export function fileOperationTargetFromArguments(run: RuntimeToolRun, t: Translate = defaultTranslate): string {
  const args = recordFromJson(run.argumentsPreview);
  const direct = stringField(args.path ?? args.file_path ?? args.target_path ?? args.file);
  if (direct) return direct;

  const argumentFiles = Array.isArray(args.files) ? args.files : Array.isArray(args.changes) ? args.changes : [];
  const argumentPaths = argumentFiles
    .map((item) => (isRecord(item) ? stringField(item.file_path ?? item.path) : ''))
    .filter(Boolean);
  if (argumentPaths.length === 1) return argumentPaths[0];
  if (argumentPaths.length > 1) return t('toolRun.file.count', { count: argumentPaths.length });
  return '';
}

export function fileOperationVerb(run: RuntimeToolRun, t: Translate = defaultTranslate): string {
  const action = fileOperationAction(run);
  const created = action === 'created';
  const deleted = action === 'deleted';
  if (run.status === 'pending_approval') {
    return automaticApprovalReviewTitle(run, t('toolRun.action.writeFiles'), t)
      ?? t('toolRun.file.awaitingWrite');
  }
  if (run.status === 'running') return t(isPreparingToolRun(run) ? 'toolRun.file.generatingChanges' : 'toolRun.file.writing');
  if (run.status === 'error') return t(created ? 'toolRun.file.createFailed' : deleted ? 'toolRun.file.deleteFailed' : 'toolRun.file.editFailed');
  if (run.status === 'cancelled') return t('toolRun.file.cancelled');
  if (run.status === 'rejected') return t('toolRun.file.rejectedWrite');
  if (created) return t('toolRun.file.generated');
  if (deleted) return t('toolRun.file.deleted');
  return t('toolRun.file.edited');
}

export type FileOperationRunSummary = {
  title: string;
  target?: string;
  changeCounts?: { additions: number; deletions: number; showZero: boolean };
};

export function fileOperationGroupSummary(runs: RuntimeToolRun[], t: Translate = defaultTranslate): FileOperationRunSummary {
  const status = toolRunGroupStatus(runs);
  const active = activeToolRunOrLast(runs);
  const entries = fileOperationEntries(runs, { appliedOnlyWhenCompletedMutation: true });
  const activeTarget = active ? fileOperationTarget(active, t) : '';
  const aggregateTarget = entries.length === 1 ? entries[0]?.path : entries.length > 1 ? t('toolRun.file.count', { count: entries.length }) : '';
  const fallbackTarget = active && isPreparingToolRun(active)
    ? aggregateTarget || activeTarget
    : activeTarget || aggregateTarget;
  const changeCounts = fileOperationGroupChangeTotals(runs) ?? undefined;
  if (status === 'running' || status === 'pending_approval') {
    return { title: active ? fileOperationVerb(active, t) : t('toolRun.file.processing'), target: fallbackTarget, changeCounts };
  }
  if (status === 'error') return { title: t('toolRun.file.failed'), target: fallbackTarget, changeCounts };
  if (status === 'cancelled') return { title: t('toolRun.file.cancelled'), target: fallbackTarget, changeCounts };
  if (status === 'rejected') return { title: t('toolRun.file.rejected'), target: fallbackTarget, changeCounts };

  const appliedEntries = entries.filter((entry) => entry.applied);
  const singleEntry = appliedEntries.length === 1 ? appliedEntries[0] : undefined;
  if (singleEntry) {
    return {
      title: completedFileOperationActionLabel(singleEntry.action, t),
      target: singleEntry.path,
      changeCounts: singleEntry.hasChangeCounts
        ? {
            additions: singleEntry.additions ?? 0,
            deletions: singleEntry.deletions ?? 0,
            showZero: true,
          }
        : undefined,
    };
  }

  return { title: completedFileOperationAggregateTitle(appliedEntries, runs.length, t) };
}

export function fileOperationAggregateTitle(runs: RuntimeToolRun[], t: Translate = defaultTranslate): string {
  const status = toolRunGroupStatus(runs);
  const hasAppliedMutation = runs.some(isRuntimeFileMutationRun);
  if (status === 'success' && hasAppliedMutation) {
    return completedFileOperationAggregateTitle(fileOperationEntries(runs).filter((entry) => entry.applied), runs.length, t);
  }
  return fileOperationGroupSummary(runs, t).title;
}

export function completedFileOperationAggregateTitle(
  entries: FileOperationEntry[],
  runCount: number,
  t: Translate = defaultTranslate,
): string {
  const counts = entries.reduce(
    (result, entry) => {
      result[entry.action] += 1;
      return result;
    },
    { created: 0, modified: 0, deleted: 0 },
  );
  const parts = [
    counts.created ? t('toolRun.file.createdCount', { count: counts.created }) : '',
    counts.modified ? t('toolRun.file.editedCount', { count: counts.modified }) : '',
    counts.deleted ? t('toolRun.file.deletedCount', { count: counts.deleted }) : '',
  ].filter(Boolean);
  return parts.length ? parts.join(t('toolRun.joiner')) : t('toolRun.file.processedCount', { count: runCount });
}

export type FileOperationAction = 'created' | 'modified' | 'deleted';
export type FileOperationEntry = {
  action: FileOperationAction;
  additions?: number;
  deletions?: number;
  hasChangeCounts?: boolean;
  applied?: boolean;
  showZeroChangeCounts?: boolean;
  path: string;
  priority: number;
};

export function fileOperationEntries(runs: RuntimeToolRun[], options: { appliedOnlyWhenCompletedMutation?: boolean } = {}): FileOperationEntry[] {
  const byPath = new Map<string, FileOperationEntry>();
  for (const run of runs) {
    const priority = isRuntimeFileMutationRun(run) ? 1 : 0;
    const changes = fileChangesFromToolRun(run);
    const entries = changes.length
      ? changes.map((change) => ({
          action: normalizeFileOperationAction(change.action),
          additions: change.additions,
          deletions: change.deletions,
          hasChangeCounts: true,
          applied: isRuntimeFileMutationRun(run),
          showZeroChangeCounts: run.status === 'success',
          path: change.path,
          priority,
        }))
      : fileOperationEntriesFromArguments(run, priority);

    for (const entry of entries) {
      if (!entry.path) continue;
      const key = normalizeFileOperationPath(entry.path);
      const current = byPath.get(key);
      if (!current || entry.priority >= current.priority) byPath.set(key, entry);
    }
  }
  const entries = [...byPath.values()];
  if (options.appliedOnlyWhenCompletedMutation && toolRunGroupStatus(runs) === 'success' && runs.some(isRuntimeFileMutationRun)) {
    return entries.filter((entry) => entry.applied);
  }
  return entries;
}

export function fileOperationEntriesFromArguments(run: RuntimeToolRun, priority: number): FileOperationEntry[] {
  const args = recordFromJson(run.argumentsPreview);
  const argumentItems = [
    ...(Array.isArray(args.files) ? args.files : []),
    ...(Array.isArray(args.changes) ? args.changes : []),
  ];
  const entries = argumentItems
    .map((item): FileOperationEntry | null => {
      if (!isRecord(item)) return null;
      const path = stringField(item.file_path ?? item.path ?? item.target_path ?? item.file);
      if (!path) return null;
      return {
        action: normalizeFileOperationAction(item.action),
        applied: false,
        path,
        priority,
      };
    })
    .filter((entry): entry is FileOperationEntry => Boolean(entry));
  return entries.length ? entries : [fileOperationEntryFromRun(run, priority)];
}

export function fileOperationEntryFromRun(run: RuntimeToolRun, priority: number): FileOperationEntry {
  const totals = fileOperationChangeTotals(run);
  return {
    action: fileOperationAction(run),
    additions: totals?.additions,
    deletions: totals?.deletions,
    hasChangeCounts: Boolean(totals),
    applied: isRuntimeFileMutationRun(run),
    showZeroChangeCounts: totals?.showZero,
    path: fileOperationTarget(run),
    priority,
  };
}

export function fileOperationAction(run: RuntimeToolRun): FileOperationAction {
  const args = recordFromJson(run.argumentsPreview);
  const action = stringField(fileChangeFromToolRun(run)?.action ?? args.action);
  if (action) return normalizeFileOperationAction(action);
  if (run.name === 'delete_file') return 'deleted';
  return 'modified';
}

export function normalizeFileOperationAction(value: unknown): FileOperationAction {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'created' || normalized === 'create' || normalized === 'new') return 'created';
  if (normalized === 'deleted' || normalized === 'delete' || normalized === 'remove' || normalized === 'removed') return 'deleted';
  return 'modified';
}

export function normalizeFileOperationPath(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/\/+$/u, '').toLowerCase();
}

export function isConcreteFileOperationTarget(value: string): boolean {
  const target = value.trim();
  return Boolean(target && !/^\d+\s*(?:个文件|files?)$/iu.test(target));
}

export function ToolRunSummaryTarget({
  inspectionKind,
  kind,
  target,
}: {
  inspectionKind?: InspectionEntryKind;
  kind?: ToolRunGroupKind;
  target?: string;
}) {
  if (!target) return null;
  if (kind === 'fileMutation' && isConcreteFileOperationTarget(target)) {
    return <FileOperationTarget target={target} />;
  }
  if (kind === 'inspection' && (inspectionKind === 'file' || inspectionKind === 'directory')) {
    return <InspectionTarget className="chat-tool-run__file-target" entry={{ kind: inspectionKind, target }} />;
  }
  return <span className="chat-tool-run__target">{target}</span>;
}

export function FileOperationTarget({ target }: { target: string }) {
  const { t } = useI18n();
  return (
    <WorkspaceFileLink
      className="chat-tool-run__file-target"
      filePath={target}
      linkKind="workspace-tool"
      onClick={(event) => event.stopPropagation()}
    >
      {pathBaseName(target, t)}
    </WorkspaceFileLink>
  );
}

export function InspectionTarget({ className, entry }: { className: string; entry: InspectionEntry }) {
  const { t } = useI18n();
  if (entry.kind === 'file') {
    return (
      <WorkspaceFileLink className={className} filePath={entry.target} linkKind="workspace-tool">
        {pathBaseName(entry.target, t)}
      </WorkspaceFileLink>
    );
  }
  if (entry.kind === 'directory') {
    return (
      <WorkspacePathLabel className={className} path={entry.target} type="directory">
        {pathBaseName(entry.target, t)}
      </WorkspacePathLabel>
    );
  }
  return <code title={entry.target}>{entry.target}</code>;
}

export function fileOperationActionLabel(action: FileOperationAction, t: Translate = defaultTranslate): string {
  if (action === 'created') return t('toolRun.file.action.create');
  if (action === 'deleted') return t('toolRun.file.action.delete');
  return t('toolRun.file.action.edit');
}

export function completedFileOperationActionLabel(action: FileOperationAction, t: Translate = defaultTranslate): string {
  if (action === 'created') return t('toolRun.file.action.created');
  if (action === 'deleted') return t('toolRun.file.action.deleted');
  return t('toolRun.file.action.edited');
}

export function pathBaseName(path: string, t: Translate = defaultTranslate): string {
  const normalized = path.trim().replace(/\\/g, '/').replace(/\/+$/u, '');
  if (!normalized || normalized === '.') return t('toolRun.projectRoot');
  return normalized.split('/').filter(Boolean).pop() ?? normalized;
}

export function fileMutationPathFromReason(value: string | undefined): string {
  return /\bto\s+(.+?)\.$/iu.exec(value ?? '')?.[1]?.trim() ?? '';
}

export function toolRunSummary(run: RuntimeToolRun, t: Translate = defaultTranslate): { title: string; target?: string } {
  const args = recordFromJson(run.argumentsPreview);
  const name = run.name;
  const path = stringField(args.path ?? args.file_path ?? args.target_path ?? args.file);
  const query = stringField(args.query);
  const command = stringField(args.command ?? args.cmd);
  const url = stringField(args.url ?? args.uri ?? args.href);

  if (isWebContentRun(run, url)) return { title: runningAware(run, t('toolRun.action.fetchWeb'), t('toolRun.action.fetchedWeb'), t), target: compactUrlTarget(url) };
  if (name === 'workspace_read_file' || name === 'read_file') return { title: runningAware(run, t('toolRun.action.readFile'), t('toolRun.action.readFileDone'), t), target: path };
  if (name === 'workspace_list_directory' || name === 'list_directory') return { title: runningAware(run, t('toolRun.action.listDirectory'), t('toolRun.action.listDirectoryDone'), t), target: path || '.' };
  if (name === 'find_files') return { title: runningAware(run, t('toolRun.action.findFiles'), t('toolRun.action.findFilesDone'), t), target: query || path };
  if (name === 'workspace_search_text' || name === 'search_text') return searchRunSummary(run, path, query, t);
  if (isFileOperationRun(run)) return { title: fileOperationVerb(run, t), target: fileOperationTarget(run, t) || path };
  if (name === 'run_shell_command' || name === 'exec_command') return shellRunSummary(run, command, t);
  if (name === 'read_shell_process') return { title: runningAware(run, t('toolRun.action.readShell'), t('toolRun.action.readShellDone'), t), target: stringField(args.process_id ?? args.processId) };
  if (name === 'remember_memory') return { title: runningAware(run, t('toolRun.action.saveMemory'), t('toolRun.action.saveMemoryDone'), t) };
  if (name === 'recall_memory') return { title: runningAware(run, t('toolRun.action.recallMemory'), t('toolRun.action.recallMemoryDone'), t), target: query };
  if (name === PUBLISH_ARTIFACT_TOOL_NAME) return { title: runningAware(run, t('toolRun.action.publishArtifact'), t('toolRun.action.publishArtifactDone'), t), target: path };
  const displayName = toolRunDisplayName(run, t);
  return { title: runningAware(run, displayName, t('toolRun.action.used', { name: displayName }), t) };
}

export function searchRunSummary(
  run: RuntimeToolRun,
  path: string,
  query: string,
  t: Translate = defaultTranslate,
): { title: string; target?: string } {
  if (!path) return { title: runningAware(run, t('toolRun.action.searchCode'), t('toolRun.action.searchCodeDone'), t), target: query };

  const scope = pathBaseName(path, t);
  const target = query ? `“${query}”` : undefined;
  if (run.status === 'pending_approval') {
    return {
      title: automaticApprovalReviewTitle(
        run,
        t('toolRun.action.searchScope', { scope }),
        t,
      ) ?? t('toolRun.search.scope.awaiting', { scope }),
      target,
    };
  }
  if (run.status === 'running') {
    return {
      title: t(isPreparingToolRun(run) ? 'toolRun.search.scope.preparing' : 'toolRun.search.scope.running', { scope }),
      target,
    };
  }
  if (run.status === 'error') return { title: t('toolRun.search.scope.failed', { scope }), target };
  if (run.status === 'cancelled') return { title: t('toolRun.search.scope.cancelled', { scope }), target };
  if (run.status === 'rejected') return { title: t('toolRun.search.scope.rejected', { scope }), target };
  return { title: t('toolRun.search.scope.completed', { scope }), target };
}

export function shellRunSummary(run: RuntimeToolRun, command: string, t: Translate = defaultTranslate): { title: string; target?: string } {
  const displayCommand = command || shellCommand(run);
  if (run.status === 'pending_approval') {
    const action = displayCommand
      ? t('toolRun.action.runCommand', { command: displayCommand })
      : t('toolRun.action.runShell');
    return {
      title: automaticApprovalReviewTitle(run, action, t)
        ?? (displayCommand
          ? t('toolRun.shell.awaitingCommand', { command: displayCommand })
          : t('toolRun.shell.awaiting')),
    };
  }
  if (run.status === 'running') {
    if (isPreparingToolRun(run)) return { title: displayCommand ? t('toolRun.shell.preparingCommand', { command: displayCommand }) : t('toolRun.shell.generatingCommand') };
    return { title: displayCommand ? t('toolRun.shell.runningCommand', { command: displayCommand }) : t('toolRun.shell.running') };
  }
  if (run.status === 'error') return { title: displayCommand ? t('toolRun.shell.failedCommand', { command: displayCommand }) : t('toolRun.shell.failed') };
  if (run.status === 'cancelled') return { title: displayCommand ? t('toolRun.shell.cancelledCommand', { command: displayCommand }) : t('toolRun.shell.cancelled') };
  if (run.status === 'rejected') return { title: displayCommand ? t('toolRun.shell.rejectedCommand', { command: displayCommand }) : t('toolRun.shell.rejected') };
  return { title: displayCommand ? t('toolRun.shell.completedCommand', { command: displayCommand }) : t('toolRun.shell.completed') };
}

export function runningAware(run: RuntimeToolRun, running: string, complete: string, t: Translate = defaultTranslate) {
  const action = running.replace(/^已?/u, '');
  if (run.status === 'pending_approval') {
    return automaticApprovalReviewTitle(run, action, t)
      ?? t('toolRun.aware.awaiting', { action });
  }
  if (run.status === 'running') return t(isPreparingToolRun(run) ? 'toolRun.aware.preparing' : 'toolRun.aware.running', { action });
  if (run.status === 'error') return t('toolRun.aware.failed', { action });
  if (run.status === 'cancelled') return t('toolRun.aware.cancelled', { action });
  if (run.status === 'rejected') return t('toolRun.aware.rejected', { action });
  return complete;
}

function automaticApprovalReviewTitle(
  run: RuntimeToolRun,
  action: string,
  t: Translate,
): string | null {
  return isAutomaticApprovalReviewPending(run)
    ? t('toolRun.approvalReview.pendingAction', { action })
    : null;
}

export function inspectionEntryIcon(kind: InspectionEntryKind) {
  if (kind === 'fileSearch') return <Search size={14} />;
  if (kind === 'gitStatus') return <TerminalSquare size={14} />;
  return <FileText size={14} />;
}

export function toolDisplayName(name: string, t: Translate = defaultTranslate): string {
  return name.replace(/^mcp\s+\S+\s+/iu, '').replace(/_/g, ' ').trim() || t('toolRun.tool');
}

function toolRunDisplayName(run: RuntimeToolRun, t: Translate): string {
  const pluginName = run.plugin?.name.trim();
  if (!pluginName) return toolDisplayName(run.name, t);
  const extensionPrefix = 'extension__';
  const separatorIndex = run.name.indexOf('__', extensionPrefix.length);
  const localName = run.name.startsWith(extensionPrefix) && separatorIndex >= 0
    ? run.name.slice(separatorIndex + 2).trim()
    : run.name.trim();
  return localName ? `${pluginName} / ${localName}` : pluginName;
}
