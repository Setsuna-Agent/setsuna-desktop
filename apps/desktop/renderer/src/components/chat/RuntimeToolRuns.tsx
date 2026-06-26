import { useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Clock3,
  FileText,
  PanelRightOpen,
  Play,
  Search,
  ShieldAlert,
  TerminalSquare,
  Undo2,
  Wrench,
  XCircle,
} from 'lucide-react';
import type { RuntimeApprovalDecision, RuntimeToolRun } from '@setsuna-desktop/contracts';
import {
  fileChangeFromToolRun,
  fileChangesFromToolRun,
  fileMutationDisplayPath,
  isRuntimeFileMutationRun,
  type RuntimeFileChange,
  type RuntimeFileChangeSummary,
  type RuntimeFileDiffLine,
} from './runtimeFileChanges.js';

type ToolRunGroup =
  | { type: 'single'; run: RuntimeToolRun }
  | { type: 'group'; id: string; kind: ToolRunGroupKind; runs: RuntimeToolRun[] };

type ToolRunGroupKind = 'inspection' | 'search' | 'shell' | 'fileMutation' | 'generic';

export function RuntimeToolRuns({
  runs,
  onAnswerApproval,
}: {
  runs: RuntimeToolRun[];
  onAnswerApproval: (approvalId: string, decision: RuntimeApprovalDecision) => void;
}) {
  const visibleRuns = runs.filter((run) => run.name || run.status || run.argumentsPreview || run.resultPreview);
  if (!visibleRuns.length) return null;
  const groups = groupToolRuns(visibleRuns);
  return (
    <div className="chat-tool-runs">
      {groups.map((group) =>
        group.type === 'single' && isFileMutationRun(group.run) ? (
          <FileMutationRunRow key={group.run.id} run={group.run} onAnswerApproval={onAnswerApproval} />
        ) : group.type === 'single' && isFlatInspectionRun(group.run) ? (
          <FlatToolRunRow key={group.run.id} run={group.run} />
        ) : group.type === 'single' ? (
          <ToolRunPanel key={group.run.id} run={group.run} onAnswerApproval={onAnswerApproval} />
        ) : (
          <ToolRunGroupPanel key={group.id} group={group} onAnswerApproval={onAnswerApproval} />
        ),
      )}
    </div>
  );
}

function ToolRunPanel({
  run,
  onAnswerApproval,
}: {
  run: RuntimeToolRun;
  onAnswerApproval: (approvalId: string, decision: RuntimeApprovalDecision) => void;
}) {
  const pendingApproval = isPendingApprovalRun(run);
  const pendingApprovalId = pendingApproval ? run.approvalId : undefined;
  const summary = toolRunSummary(run);
  const open = pendingApproval || (!isShellRun(run) && (run.status === 'error' || run.status === 'rejected'));
  return (
    <details className={`chat-tool-run chat-tool-run--${toolRunGroupKind(run)} chat-tool-run--${run.status}`} open={open}>
      <summary className="chat-tool-run__summary">
        <span className="chat-tool-run__icon">{toolRunIcon(run)}</span>
        <span className="chat-tool-run__summary-text">
          <span className="chat-tool-run__title">{summary.title}</span>
          {summary.target ? <span className="chat-tool-run__target">{summary.target}</span> : null}
        </span>
        <span className="chat-tool-run__status">{statusText(run)}</span>
      </summary>
      <div className="chat-tool-run__body">
        <ToolRunDetails run={run} onAnswerApproval={onAnswerApproval} pendingApprovalId={pendingApprovalId} />
      </div>
    </details>
  );
}

function ToolRunGroupPanel({
  group,
  onAnswerApproval,
}: {
  group: Extract<ToolRunGroup, { type: 'group' }>;
  onAnswerApproval: (approvalId: string, decision: RuntimeApprovalDecision) => void;
}) {
  const status = toolRunGroupStatus(group.runs);
  const summary = toolRunGroupSummary(group);
  const hasPendingApproval = group.runs.some(isPendingApprovalRun);
  const open = hasPendingApproval || (group.kind !== 'shell' && (status === 'running' || status === 'error' || status === 'rejected'));
  const showRunTitles = group.kind !== 'shell';
  const shellGroup = group.kind === 'shell';
  return (
    <details className={`chat-tool-run chat-tool-run--group chat-tool-run--${group.kind} chat-tool-run--${status}`} open={open}>
      <summary className="chat-tool-run__summary">
        <span className="chat-tool-run__icon">{toolRunGroupIcon(group)}</span>
        <span className="chat-tool-run__summary-text">
          <span className="chat-tool-run__title">{summary.title}</span>
          {summary.target ? <span className="chat-tool-run__target">{summary.target}</span> : null}
        </span>
        <span className="chat-tool-run__status">{statusTextFromStatus(status)}</span>
      </summary>
      <div className={`chat-tool-run__body ${shellGroup ? 'chat-tool-run__body--shell-list' : 'chat-tool-run__body--group'}`}>
        {group.kind === 'inspection' ? (
          <InspectionTargetList runs={group.runs} />
        ) : shellGroup ? (
          group.runs.map((run) => <ToolRunPanel key={run.id} run={run} onAnswerApproval={onAnswerApproval} />)
        ) : (
          group.runs.map((run) => {
            const pendingApproval = isPendingApprovalRun(run);
            const pendingApprovalId = pendingApproval ? run.approvalId : undefined;
            const runSummary = toolRunSummary(run);
            return (
              <div className="chat-tool-run__group-item" key={run.id}>
                {showRunTitles ? (
                  <div className="chat-tool-run__group-title">
                    <span>{runSummary.title}</span>
                    {runSummary.target ? <code>{runSummary.target}</code> : null}
                  </div>
                ) : null}
                <ToolRunDetails run={run} onAnswerApproval={onAnswerApproval} pendingApprovalId={pendingApprovalId} />
              </div>
            );
          })
        )}
      </div>
    </details>
  );
}

function FlatToolRunRow({ run }: { run: RuntimeToolRun }) {
  const summary = toolRunSummary(run);
  return (
    <div className={`chat-tool-run chat-tool-run--flat chat-tool-run--${toolRunGroupKind(run)} chat-tool-run--${run.status}`}>
      <div className="chat-tool-run__summary">
        <span className="chat-tool-run__icon">{toolRunIcon(run)}</span>
        <span className="chat-tool-run__summary-text">
          <span className="chat-tool-run__title">{summary.title}</span>
          {summary.target ? <span className="chat-tool-run__target">{summary.target}</span> : null}
        </span>
        <span className="chat-tool-run__status">{statusText(run)}</span>
      </div>
    </div>
  );
}

function FileMutationRunRow({
  run,
  onAnswerApproval,
}: {
  run: RuntimeToolRun;
  onAnswerApproval: (approvalId: string, decision: RuntimeApprovalDecision) => void;
}) {
  const pendingApprovalId = isPendingApprovalRun(run) ? run.approvalId : undefined;
  const target = fileMutationTarget(run);
  const error = run.status === 'error' ? formatPreview(run.resultPreview ?? '') : '';
  const totals = fileMutationChangeTotals(run);
  return (
    <div className={`chat-tool-run chat-tool-run--flat chat-tool-run--file-mutation chat-tool-run--${run.status}`}>
      <div className="chat-tool-run__summary">
        <span className="chat-tool-run__icon">{toolRunIcon(run)}</span>
        <span className="chat-tool-run__summary-text">
          <span className="chat-tool-run__file-status">
            <span>{fileMutationVerb(run)}</span>
            {target ? (
              <code className="chat-tool-run__file-target" title={target}>
                {pathBaseName(target)}
              </code>
            ) : null}
          </span>
        </span>
        <ChangeCounts additions={totals?.additions} deletions={totals?.deletions} showZero={run.status === 'running'} />
      </div>
      {pendingApprovalId ? <ApprovalActions approvalId={pendingApprovalId} onAnswerApproval={onAnswerApproval} /> : null}
      {error ? <div className="chat-tool-run__file-error">{error}</div> : null}
    </div>
  );
}

export function FileChangesSummaryCard({
  summary,
  onDiscardChanges,
  onOpenReview,
}: {
  summary: RuntimeFileChangeSummary;
  onDiscardChanges?: (filePaths: string[]) => void | Promise<void>;
  onOpenReview?: () => void;
}) {
  const [discarding, setDiscarding] = useState(false);
  const [discarded, setDiscarded] = useState(false);
  const [discardError, setDiscardError] = useState<string | null>(null);
  const fileCount = summary.files.length;
  const filePaths = [...new Set(summary.files.map((file) => file.path).filter(Boolean))];
  const canDiscard = Boolean(onDiscardChanges && filePaths.length && !discarded);
  const discardChanges = async () => {
    if (!canDiscard || discarding || !onDiscardChanges) return;
    setDiscarding(true);
    setDiscardError(null);
    try {
      await onDiscardChanges(filePaths);
      setDiscarded(true);
    } catch (unknownError) {
      setDiscardError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setDiscarding(false);
    }
  };
  return (
    <section className="chat-file-changes" aria-label="本轮文件改动">
      <div className="chat-file-changes__header">
        <span className="chat-file-changes__icon" aria-hidden="true">
          <FileText size={14} />
        </span>
        <span className="chat-file-changes__summary">
          <span className="chat-file-changes__title">已编辑 {fileCount} 个文件</span>
          <ChangeCounts additions={summary.additions} deletions={summary.deletions} showZero />
        </span>
        {onOpenReview || onDiscardChanges ? (
          <span className="chat-file-changes__actions">
            {onOpenReview ? (
              <button className="chat-file-changes__action" type="button" onClick={onOpenReview}>
                <PanelRightOpen size={13} />
                <span>审核</span>
              </button>
            ) : null}
            {onDiscardChanges ? (
              <button
                className="chat-file-changes__action chat-file-changes__action--danger"
                type="button"
                disabled={!canDiscard || discarding}
                onClick={() => void discardChanges()}
              >
                <Undo2 size={13} />
                <span>{discarding ? '撤销中' : discarded ? '已撤销' : '撤销'}</span>
              </button>
            ) : null}
          </span>
        ) : null}
      </div>
      {discardError ? <div className="chat-file-changes__error">{discardError}</div> : null}
      <div className="chat-file-changes__list">
        {summary.files.map((file) => (
          <details className="chat-file-changes__item" key={file.path}>
            <summary className="chat-file-changes__row">
              <span className="chat-file-changes__path" title={file.path}>
                {file.path}
              </span>
              <ChangeCounts additions={file.additions} deletions={file.deletions} showZero />
              <ChevronDown className="chat-file-changes__row-chevron" size={13} />
            </summary>
            <FileDiffPreview file={file} />
          </details>
        ))}
      </div>
    </section>
  );
}

function FileDiffPreview({ file }: { file: RuntimeFileChange }) {
  const lines = file.lines.slice(0, 120);
  if (!lines.length) return <div className="chat-file-review__empty">暂无可展示的 diff 内容。</div>;
  return (
    <div className="chat-file-review__diff">
      {lines.map((line, index) => (
        <div
          className={`chat-file-review__line chat-file-review__line--${diffLineClass(line)}`}
          key={`${file.path}:${index}:${line.type}`}
        >
          <span className="chat-file-review__prefix">{linePrefix(line)}</span>
          <span className="chat-file-review__line-number">{lineNumber(line)}</span>
          <code>{line.content || ' '}</code>
        </div>
      ))}
      {file.truncated ? <div className="chat-file-review__empty">diff 过大，已截断展示。</div> : null}
    </div>
  );
}

function ChangeCounts({ additions, deletions, showZero = false }: { additions?: number; deletions?: number; showZero?: boolean }) {
  const add = Number.isFinite(additions) ? Math.max(0, Number(additions)) : null;
  const del = Number.isFinite(deletions) ? Math.max(0, Number(deletions)) : null;
  if (!showZero && (add || 0) === 0 && (del || 0) === 0) return null;
  return (
    <span className="chat-change-counts" aria-label={`新增 ${add || 0} 行，删除 ${del || 0} 行`}>
      <span className="chat-change-counts__add">+{add || 0}</span>
      <span className="chat-change-counts__del">-{del || 0}</span>
    </span>
  );
}

function fileMutationChangeTotals(run: RuntimeToolRun): { additions: number; deletions: number } | null {
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

function diffLineClass(line: RuntimeFileDiffLine): string {
  if (line.type === 'added') return 'add';
  if (line.type === 'removed') return 'del';
  return line.type;
}

function linePrefix(line: RuntimeFileDiffLine): string {
  if (line.type === 'added') return '+';
  if (line.type === 'removed') return '-';
  if (line.type === 'gap') return '...';
  return ' ';
}

function lineNumber(line: RuntimeFileDiffLine): string {
  const value = line.type === 'removed' ? line.oldLine : line.newLine ?? line.oldLine;
  return value ? String(value) : '';
}

function InspectionTargetList({ runs }: { runs: RuntimeToolRun[] }) {
  const targets = inspectionTargets(runs);
  if (!targets.length) return null;
  return (
    <ul className="chat-tool-run__inspection-list">
      {targets.map((target) => (
        <li className="chat-tool-run__inspection-item" key={`${target.kind}:${target.path}`}>
          <span>{target.kind === 'directory' ? '目录' : '文件'}</span>
          <code title={target.path}>{target.path}</code>
        </li>
      ))}
    </ul>
  );
}

function ToolRunDetails({
  run,
  onAnswerApproval,
  pendingApprovalId,
}: {
  run: RuntimeToolRun;
  onAnswerApproval: (approvalId: string, decision: RuntimeApprovalDecision) => void;
  pendingApprovalId?: string;
}) {
  if (isShellRun(run)) {
    return (
      <>
        <ShellTerminalResult run={run} />
        {pendingApprovalId ? <ApprovalActions approvalId={pendingApprovalId} onAnswerApproval={onAnswerApproval} /> : null}
      </>
    );
  }
  if (toolRunGroupKind(run) === 'inspection') {
    return (
      <>
        <InspectionTargetList runs={[run]} />
        {pendingApprovalId ? <ApprovalActions approvalId={pendingApprovalId} onAnswerApproval={onAnswerApproval} /> : null}
      </>
    );
  }
  if (isFileMutationRun(run)) {
    return (
      <>
        {run.status === 'error' && run.resultPreview ? <div className="chat-tool-run__file-error">{formatPreview(run.resultPreview)}</div> : null}
        {pendingApprovalId ? <ApprovalActions approvalId={pendingApprovalId} onAnswerApproval={onAnswerApproval} /> : null}
      </>
    );
  }
  return (
    <>
      {run.approvalReason ? <ToolPreview label="授权" value={run.approvalReason} /> : null}
      {run.argumentsPreview ? <ToolPreview label="参数" value={formatPreview(run.argumentsPreview)} code /> : null}
      {run.resultPreview ? <ToolPreview label={run.status === 'error' ? '错误' : '结果'} value={formatPreview(run.resultPreview)} code /> : null}
      {pendingApprovalId ? <ApprovalActions approvalId={pendingApprovalId} onAnswerApproval={onAnswerApproval} /> : null}
    </>
  );
}

function ApprovalActions({
  approvalId,
  onAnswerApproval,
}: {
  approvalId: string;
  onAnswerApproval: (approvalId: string, decision: RuntimeApprovalDecision) => void;
}) {
  return (
    <div className="chat-tool-run__actions">
      <button type="button" onClick={() => onAnswerApproval(approvalId, 'approve')}>
        允许
      </button>
      <button type="button" onClick={() => onAnswerApproval(approvalId, 'reject')}>
        拒绝
      </button>
    </div>
  );
}

function ToolPreview({ code = false, label, value }: { code?: boolean; label: string; value: string }) {
  if (!value.trim()) return null;
  return (
    <div className="chat-tool-run__preview">
      <div className="chat-tool-run__preview-label">{label}</div>
      {code ? <pre>{value}</pre> : <p>{value}</p>}
    </div>
  );
}

function groupToolRuns(runs: RuntimeToolRun[]): ToolRunGroup[] {
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

function isShellRun(run: RuntimeToolRun): boolean {
  return toolRunGroupKind(run) === 'shell';
}

function isFileMutationRun(run: RuntimeToolRun): boolean {
  return isRuntimeFileMutationRun(run);
}

function isPendingApprovalRun(run: RuntimeToolRun): boolean {
  return run.status === 'pending_approval' && run.approvalStatus !== 'approved' && run.approvalStatus !== 'rejected';
}

function isFlatInspectionRun(run: RuntimeToolRun): boolean {
  return toolRunGroupKind(run) === 'inspection' && run.status !== 'pending_approval';
}

function toolRunGroupingKey(run: RuntimeToolRun): string {
  const kind = toolRunGroupKind(run);
  if (kind === 'fileMutation') return `${kind}:${run.id}`;
  return kind === 'generic' ? `${kind}:${run.name}` : kind;
}

function toolRunGroupKind(run: RuntimeToolRun): ToolRunGroupKind {
  if (run.name === 'workspace_read_file' || run.name === 'workspace_list_directory' || run.name === 'read_file' || run.name === 'list_directory' || run.name === 'find_files' || run.name === 'read_diff' || run.name === 'git_status') return 'inspection';
  if (isRuntimeFileMutationRun(run)) return 'fileMutation';
  if (run.name === 'workspace_search_text' || run.name.includes('search')) return 'search';
  if (run.name.includes('shell') || run.name === 'run_shell_command' || run.name === 'read_shell_process') return 'shell';
  return 'generic';
}

function toolRunGroupStatus(runs: RuntimeToolRun[]): RuntimeToolRun['status'] {
  if (runs.some((run) => run.status === 'error')) return 'error';
  if (runs.some((run) => run.status === 'pending_approval')) return 'pending_approval';
  if (runs.some((run) => run.status === 'running')) return 'running';
  if (runs.some((run) => run.status === 'rejected')) return 'rejected';
  return 'success';
}

function toolRunGroupSummary(group: Extract<ToolRunGroup, { type: 'group' }>): { title: string; target?: string } {
  if (group.kind === 'inspection') return inspectionGroupSummary(group.runs);
  if (group.kind === 'shell') return shellGroupSummary(group.runs);
  if (group.kind === 'search') return searchGroupSummary(group.runs);
  if (group.kind === 'fileMutation') return toolRunSummary(group.runs[0]);
  const status = toolRunGroupStatus(group.runs);
  const name = toolDisplayName(group.runs[0]?.name ?? '工具');
  if (status === 'running' || status === 'pending_approval') return { title: `正在使用 ${name}` };
  if (status === 'error') return { title: `${name} 调用失败` };
  return { title: `已使用 ${group.runs.length} 次 ${name}` };
}

function inspectionGroupSummary(runs: RuntimeToolRun[]): { title: string; target?: string } {
  const status = toolRunGroupStatus(runs);
  const targets = uniqueTargets(runs);
  const active = runs.findLast((run) => run.status === 'running' || run.status === 'pending_approval') ?? runs.at(-1);
  const activeTarget = active ? toolRunTarget(active) : '';
  if (status === 'running' || status === 'pending_approval') {
    return { title: active?.name === 'workspace_list_directory' || active?.name === 'list_directory' || active?.name === 'find_files' ? '正在查看目录' : '正在读取文件', target: activeTarget };
  }
  if (status === 'error') return { title: '查看文件/目录失败', target: activeTarget };
  if (targets.length > 1) return { title: `已查看 ${targets.length} 个文件/目录` };
  return { title: active?.name === 'workspace_list_directory' || active?.name === 'list_directory' || active?.name === 'find_files' ? '已查看目录' : '已读取文件', target: activeTarget };
}

function shellGroupSummary(runs: RuntimeToolRun[]): { title: string; target?: string } {
  const status = toolRunGroupStatus(runs);
  const active = runs.findLast((run) => run.status === 'running' || run.status === 'pending_approval') ?? runs.at(-1);
  const command = active ? toolRunTarget(active) : '';
  if (status === 'running' || status === 'pending_approval') return { title: '正在执行命令', target: command };
  if (status === 'error') return { title: '命令执行失败', target: command };
  return { title: `已执行 ${runs.length} 条命令` };
}

function searchGroupSummary(runs: RuntimeToolRun[]): { title: string; target?: string } {
  const status = toolRunGroupStatus(runs);
  const active = runs.findLast((run) => run.status === 'running' || run.status === 'pending_approval') ?? runs.at(-1);
  const query = active ? toolRunTarget(active) : '';
  if (status === 'running' || status === 'pending_approval') return { title: '正在搜索文本', target: query };
  if (status === 'error') return { title: '搜索文本失败', target: query };
  if (runs.length > 1) return { title: `已完成 ${runs.length} 次搜索` };
  return { title: '已搜索文本', target: query };
}

function uniqueTargets(runs: RuntimeToolRun[]): string[] {
  return [...new Set(runs.map(toolRunTarget).filter(Boolean))];
}

function inspectionTargets(runs: RuntimeToolRun[]): Array<{ path: string; kind: 'file' | 'directory' }> {
  const targets = new Map<string, { path: string; kind: 'file' | 'directory' }>();
  for (const run of runs) {
    const path = toolRunTarget(run) || (run.name === 'workspace_list_directory' ? '.' : '');
    if (!path || targets.has(path)) continue;
    targets.set(path, {
      path,
      kind: run.name === 'workspace_list_directory' || run.name === 'list_directory' || run.name === 'find_files' ? 'directory' : 'file',
    });
  }
  return [...targets.values()];
}

function toolRunTarget(run: RuntimeToolRun): string {
  const args = recordFromJson(run.argumentsPreview);
  return stringField(args.command ?? args.query ?? args.path ?? args.file_path ?? args.target_path ?? args.file ?? args.process_id ?? args.processId);
}

function fileMutationTarget(run: RuntimeToolRun): string {
  return fileMutationDisplayPath(run) || toolRunTarget(run) || fileMutationPathFromReason(run.approvalReason);
}

function fileMutationVerb(run: RuntimeToolRun): string {
  const action = String(fileChangeFromToolRun(run)?.action ?? '').toLowerCase();
  const created = action === 'created' || action === 'create';
  const deleted = action === 'deleted' || action === 'delete';
  if (run.status === 'pending_approval') return '等待授权：写入';
  if (run.status === 'running') return '正在写入';
  if (run.status === 'error') return created ? '生成失败' : deleted ? '删除失败' : '编辑失败';
  if (run.status === 'rejected') return '已拒绝写入';
  if (created) return '已生成';
  if (deleted) return '已删除';
  return '已编辑';
}

function pathBaseName(path: string): string {
  const normalized = path.trim().replace(/\\/g, '/').replace(/\/+$/u, '');
  if (!normalized || normalized === '.') return '项目根目录';
  return normalized.split('/').filter(Boolean).pop() ?? normalized;
}

function fileMutationPathFromReason(value: string | undefined): string {
  return /\bto\s+(.+?)\.$/iu.exec(value ?? '')?.[1]?.trim() ?? '';
}

function ShellTerminalResult({ run }: { run: RuntimeToolRun }) {
  const command = shellCommand(run);
  const segments = shellOutputSegments(run.resultPreview);
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

function shellCommand(run: RuntimeToolRun): string {
  const args = recordFromJson(run.argumentsPreview);
  const content = run.resultPreview ?? '';
  return stringField(args.command) || shellContentLine(content, /^\$\s+(.+)$/m) || shellContentLine(content, /^command:\s*(.+)$/im) || toolRunTarget(run);
}

function shellStatusLabel(run: RuntimeToolRun): string {
  if (run.status === 'running' || run.status === 'pending_approval') return '运行中';
  if (run.status === 'error') return '失败';
  if (run.status === 'rejected') return '已拒绝';
  const exit = shellContentLine(run.resultPreview ?? '', /^exit:\s*(.+)$/im);
  if (exit && exit !== '0') return '失败';
  return '成功';
}

function shellTerminalStatus(run: RuntimeToolRun): string {
  if (run.status === 'success') {
    const exit = shellContentLine(run.resultPreview ?? '', /^exit:\s*(.+)$/im);
    return exit && exit !== '0' ? 'error' : 'completed';
  }
  if (run.status === 'pending_approval') return 'running';
  return run.status === 'error' || run.status === 'rejected' ? 'error' : run.status;
}

function shellDiagnosticText(run: RuntimeToolRun): string {
  const content = run.resultPreview ?? '';
  const exit = shellContentLine(content, /^exit:\s*(.+)$/im);
  const cwd = shellContentLine(content, /^cwd:\s*(.+)$/im);
  return [exit ? `exit ${exit}` : '', cwd ? `cwd ${cwd}` : ''].filter(Boolean).join(' · ');
}

function shellContentLine(content: string, pattern: RegExp): string {
  return pattern.exec(content)?.[1]?.trim() ?? '';
}

function shellOutputSegments(value: string | undefined): Array<{ kind: 'stdout' | 'stderr' | 'message'; text: string }> {
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

function normalizeShellStreamText(value: string): string {
  const text = value.trimEnd();
  return !text || text.trim() === '(empty)' ? '' : text;
}

function shellMetadataLine(line: string): boolean {
  return (
    /^\$\s+/.test(line) ||
    /^(cwd|exit|status):/i.test(line) ||
    /^Process is still running\./.test(line) ||
    /^Persisted until /.test(line)
  );
}

function toolRunSummary(run: RuntimeToolRun): { title: string; target?: string } {
  const args = recordFromJson(run.argumentsPreview);
  const name = run.name;
  const path = stringField(args.path ?? args.file_path ?? args.target_path ?? args.file);
  const query = stringField(args.query);
  const command = stringField(args.command);

  if (name === 'workspace_read_file' || name === 'read_file') return { title: runningAware(run, '读取文件', '已读取文件'), target: path };
  if (name === 'workspace_list_directory' || name === 'list_directory' || name === 'find_files') return { title: runningAware(run, '查看目录', '已查看目录'), target: path || query || '.' };
  if (name === 'workspace_search_text' || name === 'search_text') return { title: runningAware(run, '搜索文本', '已搜索文本'), target: query };
  if (isRuntimeFileMutationRun(run)) return { title: fileMutationVerb(run), target: path };
  if (name === 'run_shell_command') return { title: runningAware(run, '执行命令', '已执行命令'), target: command };
  if (name === 'read_shell_process') return { title: runningAware(run, '读取命令输出', '已读取命令输出'), target: stringField(args.process_id ?? args.processId) };
  if (name === 'remember_memory') return { title: runningAware(run, '保存记忆', '已保存记忆') };
  if (name === 'recall_memory') return { title: runningAware(run, '检索记忆', '已检索记忆'), target: query };
  return { title: runningAware(run, toolDisplayName(name), `已使用 ${toolDisplayName(name)}`) };
}

function runningAware(run: RuntimeToolRun, running: string, complete: string) {
  if (run.status === 'pending_approval') return `等待授权：${running}`;
  if (run.status === 'running') return `正在${running.replace(/^已?/, '')}`;
  if (run.status === 'error') return `${running.replace(/^已?/, '')}失败`;
  if (run.status === 'rejected') return `${running.replace(/^已?/, '')}已拒绝`;
  return complete;
}

function statusText(run: RuntimeToolRun) {
  return statusTextFromStatus(run.status);
}

function statusTextFromStatus(status: RuntimeToolRun['status']) {
  if (status === 'pending_approval') return '待确认';
  if (status === 'running') return '运行中';
  if (status === 'success') return '完成';
  if (status === 'rejected') return '已拒绝';
  return '失败';
}

function toolRunGroupIcon(group: Extract<ToolRunGroup, { type: 'group' }>) {
  const status = toolRunGroupStatus(group.runs);
  if (status === 'pending_approval') return <ShieldAlert size={14} />;
  if (status === 'running') return <Clock3 size={14} />;
  if (status === 'error') return <XCircle size={14} />;
  if (status === 'rejected') return <AlertCircle size={14} />;
  if (group.kind === 'inspection') return <FileText size={14} />;
  if (group.kind === 'search') return <Search size={14} />;
  if (group.kind === 'shell') return <TerminalSquare size={14} />;
  return <CheckCircle2 size={14} />;
}

function toolRunIcon(run: RuntimeToolRun) {
  if (run.status === 'pending_approval') return <ShieldAlert size={14} />;
  if (run.status === 'running') return <Clock3 size={14} />;
  if (run.status === 'error') return <XCircle size={14} />;
  if (run.status === 'rejected') return <AlertCircle size={14} />;
  if (run.name.includes('search')) return <Search size={14} />;
  if (run.name.includes('shell')) return <TerminalSquare size={14} />;
  if (run.name.includes('file') || run.name.includes('workspace')) return <FileText size={14} />;
  if (run.name.includes('run')) return <Play size={14} />;
  if (run.status === 'success') return <CheckCircle2 size={14} />;
  return <Wrench size={14} />;
}

function recordFromJson(value: string | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toolDisplayName(name: string): string {
  return name.replace(/_/g, ' ').trim() || '工具';
}

function formatPreview(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return trimmed.length > 4000 ? `${trimmed.slice(0, 4000)}\n...` : trimmed;
  }
}
