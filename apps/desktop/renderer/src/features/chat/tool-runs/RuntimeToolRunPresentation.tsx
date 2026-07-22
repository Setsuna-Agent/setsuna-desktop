import {
  PUBLISH_ARTIFACT_TOOL_NAME,
  type RuntimeToolRun
} from '@setsuna-desktop/contracts';
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
  XCircle
} from 'lucide-react';
import { WorkspaceFileLink, WorkspacePathLabel } from '../markdown/WorkspaceFileLink.js';
import type {
  ToolRunDisplayGroup,
  ToolRunGroup,
  ToolRunGroupKind,
  ToolRunSummaryMode,
} from './runtime-tool-run-types.js';
import { isPendingRuntimeToolApproval } from './runtimeToolRunState.js';
import {
  fileChangeFromToolRun,
  fileChangesFromToolRun,
  fileMutationDisplayPath,
  isRuntimeFileMutationRun
} from './runtimeFileChanges.js';

export function fileMutationChangeTotals(run: RuntimeToolRun): { additions: number; deletions: number } | null {
  const changes = fileChangesFromToolRun(run);
  if (changes.length) {
    return {
      additions: changes.reduce((total, file) => total + file.additions, 0),
      deletions: changes.reduce((total, file) => total + file.deletions, 0),
    };
  }
  const change = fileChangeFromToolRun(run);
  return change ? { additions: change.additions, deletions: change.deletions } : null;
}

export function fileOperationChangeTotals(run: RuntimeToolRun): { additions: number; deletions: number; showZero: boolean } | null {
  const resultTotals = fileMutationChangeTotals(run);
  if (resultTotals) return { ...resultTotals, showZero: true };
  const argumentTotals = fileOperationChangeTotalsFromArguments(run);
  if (argumentTotals) return { ...argumentTotals, showZero: true };
  return null;
}

export function fileOperationGroupChangeTotals(runs: RuntimeToolRun[]): { additions: number; deletions: number; showZero: boolean } | null {
  let hasTotals = false;
  let showZero = false;
  let additions = 0;
  let deletions = 0;
  for (const entry of fileOperationEntries(runs)) {
    if (!entry.hasChangeCounts) continue;
    hasTotals = true;
    showZero = showZero || entry.showZeroChangeCounts === true;
    additions += entry.additions ?? 0;
    deletions += entry.deletions ?? 0;
  }
  if (hasTotals) return { additions, deletions, showZero: showZero || additions !== 0 || deletions !== 0 };
  return null;
}

export function fileOperationChangeTotalsFromArguments(run: RuntimeToolRun): { additions: number; deletions: number } | null {
  const args = recordFromJson(run.argumentsPreview);
  const directAdditions = optionalNumber(args.additions);
  const directDeletions = optionalNumber(args.deletions);
  if (directAdditions !== null || directDeletions !== null) {
    return { additions: directAdditions ?? 0, deletions: directDeletions ?? 0 };
  }

  const diffTotals = fileOperationDiffTotalsFromValue(args.diff ?? args.diffs ?? args.files ?? args.changes);
  if (diffTotals) return diffTotals;

  if (run.name === 'delete_file') return { additions: 0, deletions: 0 };
  if (run.name === 'append_file') {
    const content = stringField(args.content ?? args.text);
    if (content) return { additions: countTextLines(content), deletions: 0 };
  }
  if (run.name === 'write_file') {
    const content = stringField(args.content);
    if (content && !content.includes('...[truncated ')) return { additions: countTextLines(content), deletions: 0 };
  }
  return null;
}

export function fileOperationDiffTotalsFromValue(value: unknown): { additions: number; deletions: number } | null {
  const items = Array.isArray(value) ? value : [value];
  let hasDiff = false;
  let additions = 0;
  let deletions = 0;
  for (const item of items) {
    if (!isRecord(item)) continue;
    const nested = fileOperationDiffTotalsFromValue(item.diff ?? item.diffs ?? item.files ?? item.changes);
    if (nested) {
      hasDiff = true;
      additions += nested.additions;
      deletions += nested.deletions;
      continue;
    }
    const itemAdditions = optionalNumber(item.additions);
    const itemDeletions = optionalNumber(item.deletions);
    if (itemAdditions !== null || itemDeletions !== null) {
      hasDiff = true;
      additions += itemAdditions ?? 0;
      deletions += itemDeletions ?? 0;
    }
  }
  return hasDiff ? { additions, deletions } : null;
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

export function mixedToolRunGroupSummary(groups: ToolRunGroup[], summaryMode: ToolRunSummaryMode): CompactToolRunSummary {
  if (summaryMode === 'latest') return compactToolRunGroupSummary(groups.at(-1));
  return { title: mixedToolRunGroupAggregateTitle(groups) };
}

export function compactToolRunGroupSummary(group: ToolRunGroup | undefined): CompactToolRunSummary {
  if (!group) return { title: '' };
  const runs = toolRunGroupRuns(group);
  const kind = group.type === 'single' ? toolRunGroupKind(group.run) : group.kind;
  if (kind === 'fileMutation') return { ...fileOperationGroupSummary(runs), targetKind: kind };
  if (group.type === 'single') {
    return {
      ...toolRunSummary(group.run),
      targetKind: kind,
      inspectionKind: kind === 'inspection' ? inspectionEntryKind(group.run) : undefined,
    };
  }
  if (kind === 'shell' && runs.length === 1) return { ...toolRunSummary(runs[0]), targetKind: kind };
  return { title: mixedToolRunGroupPart(group) };
}

export function mixedToolRunGroupAggregateTitle(groups: ToolRunGroup[]): string {
  const buckets: Array<{ key: string; kind: ToolRunGroupKind | 'webContent'; runs: RuntimeToolRun[] }> = [];
  const bucketByKey = new Map<string, { key: string; kind: ToolRunGroupKind | 'webContent'; runs: RuntimeToolRun[] }>();

  for (const group of groups) {
    const runs = toolRunGroupRuns(group);
    const kind = group.type === 'single' ? toolRunGroupKind(group.run) : group.kind;
    const webContent = kind === 'generic' && webContentGroupSummary(runs);
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
    .map((bucket) => mixedToolRunBucketSummary(bucket.kind, bucket.runs))
    .filter(Boolean)
    .join('，');
}

export function mixedToolRunBucketSummary(kind: ToolRunGroupKind | 'webContent', runs: RuntimeToolRun[]): string {
  const status = toolRunGroupStatus(runs);
  if (kind === 'fileMutation') return fileOperationAggregateTitle(runs);
  if (kind === 'inspection') {
    const parts = inspectionSummaryParts(inspectionEntries(runs));
    return parts.length ? parts.join('，') : inspectionGroupSummary(runs).title;
  }
  if (kind === 'shell') return shellCountSummary(runs, status);
  if (kind === 'search') return searchCountSummary(runs, status);
  if (kind === 'webContent') return webContentGroupSummary(runs)?.title ?? '';
  const name = toolDisplayName(runs[0]?.name ?? '工具');
  if (status === 'running' || status === 'pending_approval') return `正在使用 ${name}`;
  if (status === 'cancelled') return `已取消 ${name}`;
  if (status === 'rejected') return `已拒绝 ${name}`;
  return `已使用 ${runs.length} 次 ${name}`;
}

export function mixedToolRunGroupPart(group: ToolRunGroup): string {
  const runs = toolRunGroupRuns(group);
  const kind = group.type === 'single' ? toolRunGroupKind(group.run) : group.kind;
  const status = toolRunGroupStatus(runs);
  if (kind === 'fileMutation') return fileOperationAggregateTitle(runs);
  if (kind === 'shell') return shellCountSummary(runs, status);
  if (kind === 'inspection') return inspectionGroupSummary(runs).title;
  if (kind === 'search') return searchCountSummary(runs, status);
  const webContentSummary = webContentGroupSummary(runs);
  if (webContentSummary) return webContentSummary.title;
  const name = toolDisplayName(runs[0]?.name ?? '工具');
  if (status === 'running' || status === 'pending_approval') return `正在使用 ${name}`;
  if (status === 'cancelled') return `已取消 ${name}`;
  if (status === 'rejected') return `已拒绝 ${name}`;
  return `已使用 ${runs.length} 次 ${name}`;
}

export function shellCountSummary(runs: RuntimeToolRun[], status: RuntimeToolRun['status']): string {
  if (status === 'running' || status === 'pending_approval') return `正在运行 ${runs.length} 条命令`;
  if (status === 'cancelled') return `已取消 ${runs.length} 条命令`;
  if (status === 'rejected') return `已拒绝 ${runs.length} 条命令`;
  return `已运行 ${runs.length} 条命令`;
}

export function searchCountSummary(runs: RuntimeToolRun[], status: RuntimeToolRun['status']): string {
  if (status === 'running' || status === 'pending_approval') return `正在搜索 ${runs.length} 次代码`;
  if (status === 'cancelled') return `已取消 ${runs.length} 次搜索`;
  if (status === 'rejected') return `已拒绝 ${runs.length} 次搜索`;
  return `已搜索 ${runs.length} 次代码`;
}

export function mixedToolRunGroupIcon(status: RuntimeToolRun['status']) {
  if (status === 'pending_approval') return <ShieldAlert size={14} />;
  if (status === 'running') return <Clock3 size={14} />;
  if (status === 'cancelled') return <XCircle size={14} />;
  if (status === 'rejected') return <AlertCircle size={14} />;
  return <CheckCircle2 size={14} />;
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

export function toolRunGroupingKey(run: RuntimeToolRun): string {
  const kind = toolRunGroupKind(run);
  return kind === 'generic' ? `${kind}:${run.name}` : kind;
}

export function toolRunGroupKind(run: RuntimeToolRun): ToolRunGroupKind {
  if (run.name === 'workspace_read_file' || run.name === 'workspace_list_directory' || run.name === 'read_file' || run.name === 'list_directory' || run.name === 'find_files' || run.name === 'read_diff' || run.name === 'git_status') return 'inspection';
  if (isFileOperationRun(run)) return 'fileMutation';
  if (run.name === 'workspace_search_text' || run.name === 'search_text') return 'search';
  if (run.name.includes('shell') || run.name === 'run_shell_command' || run.name === 'read_shell_process' || run.name === 'exec_command' || run.name === 'write_stdin') return 'shell';
  return 'generic';
}

export function toolRunGroupStatus(runs: RuntimeToolRun[]): RuntimeToolRun['status'] {
  if (runs.some((run) => run.status === 'error')) return 'error';
  if (runs.some((run) => run.status === 'pending_approval')) return 'pending_approval';
  if (runs.some((run) => run.status === 'running')) return 'running';
  if (runs.some((run) => run.status === 'cancelled')) return 'cancelled';
  if (runs.some((run) => run.status === 'rejected')) return 'rejected';
  return 'success';
}

export function activeToolRunOrLast(runs: RuntimeToolRun[]): RuntimeToolRun | undefined {
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    const run = runs[index];
    if (run && (run.status === 'running' || run.status === 'pending_approval')) return run;
  }
  return runs.at(-1);
}

export function toolRunGroupSummary(group: Extract<ToolRunGroup, { type: 'group' }>): { title: string; target?: string } {
  if (group.kind === 'inspection') return inspectionGroupSummary(group.runs);
  if (group.kind === 'shell') return shellGroupSummary(group.runs);
  if (group.kind === 'search') return searchGroupSummary(group.runs);
  if (group.kind === 'fileMutation') return fileOperationGroupSummary(group.runs);
  const webContentSummary = webContentGroupSummary(group.runs);
  if (webContentSummary) return webContentSummary;
  const status = toolRunGroupStatus(group.runs);
  const name = toolDisplayName(group.runs[0]?.name ?? '工具');
  if (status === 'running' || status === 'pending_approval') return { title: `正在使用 ${name}` };
  if (status === 'error') return { title: `${name} 调用失败` };
  if (status === 'cancelled') return { title: `已取消 ${name}` };
  if (status === 'rejected') return { title: `已拒绝 ${name}` };
  return { title: `已使用 ${group.runs.length} 次 ${name}` };
}

export function inspectionGroupSummary(runs: RuntimeToolRun[]): { title: string; target?: string } {
  const status = toolRunGroupStatus(runs);
  const active = activeToolRunOrLast(runs);
  const activeEntry = active ? inspectionEntryFromRun(active) : null;
  const activeTarget = activeEntry?.target ?? '';
  if (status === 'running' || status === 'pending_approval') {
    return {
      title: active && isPreparingToolRun(active)
        ? '正在准备查看文件/目录'
        : activeEntry ? inspectionRunningTitle(activeEntry.kind) : '正在查看文件/目录',
      target: activeTarget,
    };
  }
  if (status === 'error') return { title: '查看文件/目录失败', target: activeTarget };
  if (status === 'cancelled') return { title: '已取消查看文件/目录', target: activeTarget };
  if (status === 'rejected') return { title: '已拒绝查看文件/目录', target: activeTarget };
  const parts = inspectionSummaryParts(inspectionEntries(runs));
  if (parts.length) return { title: parts.join('，') };
  return { title: activeEntry ? inspectionCompleteTitle(activeEntry.kind) : '已查看文件/目录', target: activeTarget };
}

export function shellGroupSummary(runs: RuntimeToolRun[]): { title: string; target?: string } {
  const status = toolRunGroupStatus(runs);
  const active = activeToolRunOrLast(runs);
  const command = active ? shellCommand(active) : '';
  if (status === 'running' || status === 'pending_approval') {
    if (active && isPreparingToolRun(active)) return { title: command ? `正在准备运行 ${command}` : '正在生成命令' };
    return { title: command ? `正在运行 ${command}` : '正在运行命令' };
  }
  if (status === 'error') return { title: command ? `命令运行失败 ${command}` : '命令运行失败' };
  if (status === 'cancelled') return { title: command ? `已取消运行 ${command}` : '已取消运行命令' };
  if (status === 'rejected') return { title: command ? `已拒绝运行 ${command}` : '已拒绝运行命令' };
  return { title: `已运行 ${runs.length} 条命令` };
}

export function searchGroupSummary(runs: RuntimeToolRun[]): { title: string; target?: string } {
  const status = toolRunGroupStatus(runs);
  const active = activeToolRunOrLast(runs);
  const query = active ? toolRunTarget(active) : '';
  if (status === 'running' || status === 'pending_approval') return { title: active && isPreparingToolRun(active) ? '正在准备搜索代码' : '正在搜索代码', target: query };
  if (status === 'error') return { title: '搜索代码失败', target: query };
  if (status === 'cancelled') return { title: '已取消搜索代码', target: query };
  if (status === 'rejected') return { title: '已拒绝搜索代码', target: query };
  if (runs.length > 1) return { title: `已搜索 ${runs.length} 次代码` };
  return { title: '已搜索代码', target: query };
}

export function webContentGroupSummary(runs: RuntimeToolRun[]): { title: string; target?: string } | null {
  if (!runs.length || runs.some((run) => !isWebContentRun(run))) return null;
  const status = toolRunGroupStatus(runs);
  const active = activeToolRunOrLast(runs);
  const target = active ? toolRunTarget(active) : '';
  if (status === 'running' || status === 'pending_approval') return { title: active && isPreparingToolRun(active) ? '正在准备获取网页' : '正在获取网页', target };
  if (status === 'error') return { title: '获取网页失败', target };
  if (status === 'cancelled') return { title: '已取消获取网页', target };
  if (status === 'rejected') return { title: '已拒绝获取网页', target };
  if (runs.length > 1) return { title: `已获取 ${runs.length} 个网页` };
  return { title: '已获取网页', target };
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

export function inspectionSummaryParts(entries: InspectionEntry[]): string[] {
  const counts = new Map<InspectionEntryKind, number>();
  const order: InspectionEntryKind[] = [];
  for (const entry of entries) {
    if (!counts.has(entry.kind)) order.push(entry.kind);
    counts.set(entry.kind, (counts.get(entry.kind) ?? 0) + 1);
  }
  return order.map((kind) => inspectionSummaryPart(kind, counts.get(kind) ?? 0)).filter(Boolean);
}

export function inspectionSummaryPart(kind: InspectionEntryKind, count: number): string {
  if (kind === 'directory') return `已查看 ${count} 个目录`;
  if (kind === 'fileSearch') return `已查找 ${count} 次文件`;
  if (kind === 'gitStatus') return '已查看 Git 状态';
  return `已读取 ${count} 个文件`;
}

export function inspectionEntryLabel(kind: InspectionEntryKind): string {
  if (kind === 'directory') return '已查看目录';
  if (kind === 'fileSearch') return '已查找文件';
  if (kind === 'gitStatus') return '已查看状态';
  return '已读取文件';
}

export function inspectionRunningTitle(kind: InspectionEntryKind): string {
  if (kind === 'directory') return '正在查看目录';
  if (kind === 'fileSearch') return '正在查找文件';
  if (kind === 'gitStatus') return '正在查看 Git 状态';
  return '正在读取文件';
}

export function inspectionCompleteTitle(kind: InspectionEntryKind): string {
  if (kind === 'directory') return '已查看目录';
  if (kind === 'fileSearch') return '已查找文件';
  if (kind === 'gitStatus') return '已查看 Git 状态';
  return '已读取文件';
}

export function toolRunTarget(run: RuntimeToolRun): string {
  const args = recordFromJson(run.argumentsPreview);
  const url = stringField(args.url ?? args.uri ?? args.href);
  if (url) return compactUrlTarget(url);
  return stringField(args.command ?? args.cmd ?? args.query ?? args.path ?? args.file_path ?? args.target_path ?? args.file ?? args.process_id ?? args.processId);
}

export function fileOperationTarget(run: RuntimeToolRun): string {
  const args = recordFromJson(run.argumentsPreview);
  if (hasIncompleteFileOperationPath(args)) return '';
  return fileMutationDisplayPath(run) || fileOperationTargetFromArguments(run) || toolRunTarget(run) || fileMutationPathFromReason(run.approvalReason);
}

export function hasIncompleteFileOperationPath(args: Record<string, unknown>): boolean {
  return [
    ['path', 'path_closed'],
    ['file_path', 'file_path_closed'],
    ['target_path', 'target_path_closed'],
    ['file', 'file_closed'],
  ].some(([pathKey, closedKey]) => Boolean(stringField(args[pathKey])) && args[closedKey] === false);
}

export function fileOperationTargetFromArguments(run: RuntimeToolRun): string {
  const args = recordFromJson(run.argumentsPreview);
  const direct = stringField(args.path ?? args.file_path ?? args.target_path ?? args.file);
  if (direct) return direct;

  const argumentFiles = Array.isArray(args.files) ? args.files : Array.isArray(args.changes) ? args.changes : [];
  const argumentPaths = argumentFiles
    .map((item) => (isRecord(item) ? stringField(item.file_path ?? item.path) : ''))
    .filter(Boolean);
  if (argumentPaths.length === 1) return argumentPaths[0];
  if (argumentPaths.length > 1) return `${argumentPaths.length} 个文件`;
  return '';
}

export function fileOperationVerb(run: RuntimeToolRun): string {
  const action = fileOperationAction(run);
  const created = action === 'created';
  const deleted = action === 'deleted';
  if (run.status === 'pending_approval') return '等待授权：写入';
  if (run.status === 'running') return isPreparingToolRun(run) ? '正在生成修改' : '正在写入';
  if (run.status === 'error') return created ? '生成失败' : deleted ? '删除失败' : '编辑失败';
  if (run.status === 'cancelled') return '已取消文件操作';
  if (run.status === 'rejected') return '已拒绝写入';
  if (created) return '已生成';
  if (deleted) return '已删除';
  return '已编辑';
}

export type FileOperationRunSummary = {
  title: string;
  target?: string;
  changeCounts?: { additions: number; deletions: number; showZero: boolean };
};

export function fileOperationGroupSummary(runs: RuntimeToolRun[]): FileOperationRunSummary {
  const status = toolRunGroupStatus(runs);
  const active = activeToolRunOrLast(runs);
  const entries = fileOperationEntries(runs, { appliedOnlyWhenCompletedMutation: true });
  const activeTarget = active ? fileOperationTarget(active) : '';
  const fallbackTarget = activeTarget || (entries.length === 1 ? entries[0]?.path : entries.length > 1 ? `${entries.length} 个文件` : '');
  const changeCounts = fileOperationGroupChangeTotals(runs) ?? undefined;
  if (status === 'running' || status === 'pending_approval') {
    return { title: active ? fileOperationVerb(active) : '正在处理文件', target: fallbackTarget, changeCounts };
  }
  if (status === 'error') return { title: '文件操作失败', target: fallbackTarget, changeCounts };
  if (status === 'cancelled') return { title: '已取消文件操作', target: fallbackTarget, changeCounts };
  if (status === 'rejected') return { title: '已拒绝文件操作', target: fallbackTarget, changeCounts };

  const appliedEntries = entries.filter((entry) => entry.applied);
  const singleEntry = appliedEntries.length === 1 ? appliedEntries[0] : undefined;
  if (singleEntry) {
    return {
      title: completedFileOperationActionLabel(singleEntry.action),
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

  return { title: completedFileOperationAggregateTitle(appliedEntries, runs.length) };
}

export function fileOperationAggregateTitle(runs: RuntimeToolRun[]): string {
  const status = toolRunGroupStatus(runs);
  const hasAppliedMutation = runs.some(isRuntimeFileMutationRun);
  if (status === 'success' && hasAppliedMutation) {
    return completedFileOperationAggregateTitle(fileOperationEntries(runs).filter((entry) => entry.applied), runs.length);
  }
  return fileOperationGroupSummary(runs).title;
}

export function completedFileOperationAggregateTitle(entries: FileOperationEntry[], runCount: number): string {
  const counts = entries.reduce(
    (result, entry) => {
      result[entry.action] += 1;
      return result;
    },
    { created: 0, modified: 0, deleted: 0 },
  );
  const parts = [
    counts.created ? `已创建 ${counts.created} 个文件` : '',
    counts.modified ? `已编辑 ${counts.modified} 个文件` : '',
    counts.deleted ? `已删除 ${counts.deleted} 个文件` : '',
  ].filter(Boolean);
  return parts.length ? parts.join('，') : `已处理 ${runCount} 个文件操作`;
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
          showZeroChangeCounts: true,
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
  return Boolean(target && !/^\d+\s*个文件$/u.test(target));
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
  return (
    <WorkspaceFileLink className="chat-tool-run__file-target" filePath={target} linkKind="workspace-tool">
      {pathBaseName(target)}
    </WorkspaceFileLink>
  );
}

export function InspectionTarget({ className, entry }: { className: string; entry: InspectionEntry }) {
  if (entry.kind === 'file') {
    return (
      <WorkspaceFileLink className={className} filePath={entry.target} linkKind="workspace-tool">
        {pathBaseName(entry.target)}
      </WorkspaceFileLink>
    );
  }
  if (entry.kind === 'directory') {
    return (
      <WorkspacePathLabel className={className} path={entry.target} type="directory">
        {pathBaseName(entry.target)}
      </WorkspacePathLabel>
    );
  }
  return <code title={entry.target}>{entry.target}</code>;
}

export function fileOperationActionLabel(action: FileOperationAction): string {
  if (action === 'created') return '创建';
  if (action === 'deleted') return '删除';
  return '编辑';
}

export function completedFileOperationActionLabel(action: FileOperationAction): string {
  if (action === 'created') return '已创建';
  if (action === 'deleted') return '已删除';
  return '已编辑';
}

export function pathBaseName(path: string): string {
  const normalized = path.trim().replace(/\\/g, '/').replace(/\/+$/u, '');
  if (!normalized || normalized === '.') return '项目根目录';
  return normalized.split('/').filter(Boolean).pop() ?? normalized;
}

export function fileMutationPathFromReason(value: string | undefined): string {
  return /\bto\s+(.+?)\.$/iu.exec(value ?? '')?.[1]?.trim() ?? '';
}

export function ShellTerminalResult({ run }: { run: RuntimeToolRun }) {
  const command = shellCommand(run);
  const segments = shellOutputSegments(shellResultPreviewForDisplay(run));
  const status = shellStatusLabel(run);
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
              <pre key={`${segment.kind}-${index}`} className={`chat-mcp-terminal__stream chat-mcp-terminal__stream--${segment.kind}`}>
                {segment.text}
              </pre>
            ))}
          </div>
        ) : null}
      </div>
      <div className="chat-mcp-terminal__footer">{diagnostic ? `${status} · ${diagnostic}` : status}</div>
    </div>
  );
}

export function shellCommand(run: RuntimeToolRun): string {
  const args = recordFromJson(run.argumentsPreview);
  const content = run.resultPreview ?? '';
  return stringField(args.command ?? args.cmd) || shellContentLine(content, /^\$\s+(.+)$/m) || shellContentLine(content, /^command:\s*(.+)$/im) || toolRunTarget(run);
}

export function shellResultPreviewForDisplay(run: RuntimeToolRun): string | undefined {
  if (run.status !== 'pending_approval' && run.status !== 'running') return run.resultPreview;
  const preview = run.resultPreview ?? '';
  const showsSandboxFailure = /\bspawn\b[^\r\n]*\b(?:EPERM|EACCES)\b|\boperation not permitted\b|\bpermission denied\b|\bread-only file system\b/iu.test(preview);
  if (!showsSandboxFailure) return run.resultPreview;
  if (run.approvalRetryKind === 'sandbox_bypass') return undefined;

  // Older persisted approvals predate retryKind. Keep them compact after an
  // app update by recognizing the stable sandbox-retry wording.
  const reason = run.approvalReason ?? '';
  const legacySandboxRetry = reason.startsWith('Sandbox denied ')
    && reason.includes('Approve retry without the OS sandbox.');
  return legacySandboxRetry ? undefined : run.resultPreview;
}

export function shellStatusLabel(run: RuntimeToolRun): string {
  if (run.status === 'running' || run.status === 'pending_approval') return '运行中';
  if (run.status === 'error') return '失败';
  if (run.status === 'cancelled') return '已取消';
  if (run.status === 'rejected') return '已拒绝';
  const exit = shellContentLine(run.resultPreview ?? '', /^exit:\s*(.+)$/im);
  if (exit && exit !== '0') return '失败';
  return '成功';
}

export function shellTerminalStatus(run: RuntimeToolRun): string {
  if (run.status === 'success') {
    const exit = shellContentLine(run.resultPreview ?? '', /^exit:\s*(.+)$/im);
    return exit && exit !== '0' ? 'error' : 'completed';
  }
  if (run.status === 'pending_approval') return 'running';
  if (run.status === 'cancelled') return 'cancelled';
  return run.status === 'error' || run.status === 'rejected' ? 'error' : run.status;
}

export function shellDiagnosticText(run: RuntimeToolRun): string {
  const content = run.resultPreview ?? '';
  const exit = shellContentLine(content, /^exit:\s*(.+)$/im);
  const cwd = shellContentLine(content, /^cwd:\s*(.+)$/im);
  return [exit ? `exit ${exit}` : '', cwd ? `cwd ${cwd}` : ''].filter(Boolean).join(' · ');
}

export function shellContentLine(content: string, pattern: RegExp): string {
  return pattern.exec(content)?.[1]?.trim() ?? '';
}

export function shellOutputSegments(value: string | undefined): Array<{ kind: 'stdout' | 'stderr' | 'message'; text: string }> {
  const normalized = String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n\nProcess is still running\.[\s\S]*$/u, '')
    .trimEnd();
  if (!normalized) return [];

  const segments: Array<{ kind: 'stdout' | 'stderr' | 'message'; text: string }> = [];
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
    /^\$\s+/.test(line) ||
    /^(cwd|exit|status):/i.test(line) ||
    /^Process is still running\./.test(line) ||
    /^Persisted until /.test(line)
  );
}

export function toolRunSummary(run: RuntimeToolRun): { title: string; target?: string } {
  const args = recordFromJson(run.argumentsPreview);
  const name = run.name;
  const path = stringField(args.path ?? args.file_path ?? args.target_path ?? args.file);
  const query = stringField(args.query);
  const command = stringField(args.command ?? args.cmd);
  const url = stringField(args.url ?? args.uri ?? args.href);

  if (isWebContentRun(run, url)) return { title: runningAware(run, '获取网页', '已获取网页'), target: compactUrlTarget(url) };
  if (name === 'workspace_read_file' || name === 'read_file') return { title: runningAware(run, '读取文件', '已读取文件'), target: path };
  if (name === 'workspace_list_directory' || name === 'list_directory') return { title: runningAware(run, '查看目录', '已查看目录'), target: path || '.' };
  if (name === 'find_files') return { title: runningAware(run, '查找文件', '已查找文件'), target: query || path };
  if (name === 'workspace_search_text' || name === 'search_text') return searchRunSummary(run, path, query);
  if (isFileOperationRun(run)) return { title: fileOperationVerb(run), target: fileOperationTarget(run) || path };
  if (name === 'run_shell_command' || name === 'exec_command') return shellRunSummary(run, command);
  if (name === 'read_shell_process') return { title: runningAware(run, '读取命令输出', '已读取命令输出'), target: stringField(args.process_id ?? args.processId) };
  if (name === 'remember_memory') return { title: runningAware(run, '保存记忆', '已保存记忆') };
  if (name === 'recall_memory') return { title: runningAware(run, '检索记忆', '已检索记忆'), target: query };
  if (name === PUBLISH_ARTIFACT_TOOL_NAME) return { title: runningAware(run, '发布产物', '已发布产物'), target: path };
  return { title: runningAware(run, toolDisplayName(name), `已使用 ${toolDisplayName(name)}`) };
}

export function searchRunSummary(run: RuntimeToolRun, path: string, query: string): { title: string; target?: string } {
  if (!path) return { title: runningAware(run, '搜索代码', '已搜索代码'), target: query };

  const scope = pathBaseName(path);
  const target = query ? `“${query}”` : undefined;
  if (run.status === 'pending_approval') return { title: `等待授权：在 ${scope} 中搜索`, target };
  if (run.status === 'running') {
    return {
      title: isPreparingToolRun(run) ? `正在准备在 ${scope} 中搜索` : `正在 ${scope} 中搜索`,
      target,
    };
  }
  if (run.status === 'error') return { title: `在 ${scope} 中搜索失败`, target };
  if (run.status === 'cancelled') return { title: `已取消在 ${scope} 中搜索`, target };
  if (run.status === 'rejected') return { title: `已拒绝在 ${scope} 中搜索`, target };
  return { title: `已在 ${scope} 中搜索`, target };
}

export function shellRunSummary(run: RuntimeToolRun, command: string): { title: string; target?: string } {
  const displayCommand = command || shellCommand(run);
  if (run.status === 'pending_approval') return { title: displayCommand ? `等待授权：运行 ${displayCommand}` : '等待授权：运行命令' };
  if (run.status === 'running') {
    if (isPreparingToolRun(run)) return { title: displayCommand ? `正在准备运行 ${displayCommand}` : '正在生成命令' };
    return { title: displayCommand ? `正在运行 ${displayCommand}` : '正在运行命令' };
  }
  if (run.status === 'error') return { title: displayCommand ? `命令运行失败 ${displayCommand}` : '命令运行失败' };
  if (run.status === 'cancelled') return { title: displayCommand ? `已取消运行 ${displayCommand}` : '已取消运行命令' };
  if (run.status === 'rejected') return { title: displayCommand ? `已拒绝运行 ${displayCommand}` : '已拒绝运行命令' };
  return { title: displayCommand ? `已运行 ${displayCommand}` : '已运行命令' };
}

export function runningAware(run: RuntimeToolRun, running: string, complete: string) {
  if (run.status === 'pending_approval') return `等待授权：${running}`;
  if (run.status === 'running') return `${isPreparingToolRun(run) ? '正在准备' : '正在'}${running.replace(/^已?/, '')}`;
  if (run.status === 'error') return `${running.replace(/^已?/, '')}失败`;
  if (run.status === 'cancelled') return `${running.replace(/^已?/, '')}已取消`;
  if (run.status === 'rejected') return `${running.replace(/^已?/, '')}已拒绝`;
  return complete;
}

export function ToolRunStatus({
  status,
  summaryTitle,
}: {
  status: RuntimeToolRun['status'];
  summaryTitle?: string;
}) {
  const text = statusTextFromStatus(status, summaryTitle);
  return text ? <span className="chat-tool-run__status">{text}</span> : null;
}

export function statusTextFromStatus(status: RuntimeToolRun['status'], summaryTitle = '') {
  if (status === 'pending_approval') return summaryTitle.trim().startsWith('等待授权') ? '' : '待确认';
  if (status === 'cancelled') return '已取消';
  if (status === 'rejected') return '已拒绝';
  if (status === 'error') return '失败';
  return '';
}

export function toolRunGroupIcon(group: Extract<ToolRunGroup, { type: 'group' }>) {
  const status = toolRunGroupStatus(group.runs);
  if (status === 'pending_approval') return <ShieldAlert size={14} />;
  if (status === 'running') return <Clock3 size={14} />;
  if (status === 'error') return <XCircle size={14} />;
  if (status === 'cancelled') return <XCircle size={14} />;
  if (status === 'rejected') return <AlertCircle size={14} />;
  if (group.kind === 'inspection') return <FileText size={14} />;
  if (group.kind === 'search') return <Search size={14} />;
  if (group.kind === 'shell') return <TerminalSquare size={14} />;
  if (group.kind === 'fileMutation') return <Pencil size={14} />;
  return <CheckCircle2 size={14} />;
}

export function toolRunIcon(run: RuntimeToolRun) {
  if (run.status === 'pending_approval') return <ShieldAlert size={14} />;
  if (run.status === 'running') return <Clock3 size={14} />;
  if (run.status === 'error') return <XCircle size={14} />;
  if (run.status === 'cancelled') return <XCircle size={14} />;
  if (run.status === 'rejected') return <AlertCircle size={14} />;
  if (run.name.includes('search')) return <Search size={14} />;
  if (run.name.includes('shell')) return <TerminalSquare size={14} />;
  if (isFileOperationRun(run)) return <Pencil size={14} />;
  if (run.name.includes('file') || run.name.includes('workspace')) return <FileText size={14} />;
  if (run.name.includes('run')) return <Play size={14} />;
  if (run.status === 'success') return <CheckCircle2 size={14} />;
  return <Wrench size={14} />;
}

export function recordFromJson(value: string | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function stringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function optionalNumber(value: unknown): number | null {
  const numberValue = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(numberValue) ? Math.max(0, numberValue) : null;
}

export function countTextLines(value: string): number {
  if (!value) return 0;
  const lines = value.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines.length;
}

export function toolDisplayName(name: string): string {
  return name.replace(/^mcp\s+\S+\s+/iu, '').replace(/_/g, ' ').trim() || '工具';
}

export function formatPreview(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return trimmed.length > 4000 ? `${trimmed.slice(0, 4000)}\n...` : trimmed;
  }
}

export function isWebContentRun(run: RuntimeToolRun, url = stringField(recordFromJson(run.argumentsPreview).url)): boolean {
  if (!url) return false;
  return /(^|\s|_|-)fetch(web)?content($|\s|_|-)/iu.test(run.name) || /^https?:\/\//iu.test(url);
}

export function compactUrlTarget(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed);
    const path = `${url.pathname}${url.search}`.replace(/\/$/u, '') || '/';
    return `${url.hostname}${path}`;
  } catch {
    return trimmed.replace(/^https?:\/\//iu, '').replace(/\/$/u, '');
  }
}

export function genericToolRunDiagnostic(run: RuntimeToolRun): string {
  if (run.status !== 'error' && run.status !== 'rejected' && run.status !== 'cancelled') return '';
  return concisePreview(run.approvalMessage || run.resultPreview || run.approvalReason || '');
}

export function isPreparingToolRun(run: RuntimeToolRun): boolean {
  return run.status === 'running' && run.phase === 'preparing';
}

export function concisePreview(value: string): string {
  const normalized = formatPreview(value).replace(/\s+/gu, ' ').trim();
  return normalized.length > 600 ? `${normalized.slice(0, 600)}...` : normalized;
}
