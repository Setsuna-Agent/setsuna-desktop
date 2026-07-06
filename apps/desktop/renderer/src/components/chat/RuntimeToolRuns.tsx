import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Clock3,
  FileText,
  PanelRightOpen,
  Pencil,
  Play,
  Search,
  ShieldAlert,
  TerminalSquare,
  Undo2,
  Wrench,
  XCircle,
} from 'lucide-react';
import type { AnswerRuntimeApprovalInput, RuntimeApprovalAvailableDecision, RuntimeHookRun, RuntimeToolRun } from '@setsuna-desktop/contracts';
import { fileLanguage, highlightedCodeLinesHtml } from '../workspace/codeHighlight.js';
import {
  fileChangeFromToolRun,
  fileChangesFromToolRun,
  fileMutationDisplayPath,
  isRuntimeFileMutationRun,
  type RuntimeFileChange,
  type RuntimeFileChangeSummary,
  type RuntimeFileDiffLine,
} from './runtimeFileChanges.js';

export type ToolRunGroup =
  | { type: 'single'; run: RuntimeToolRun }
  | { type: 'group'; id: string; kind: ToolRunGroupKind; runs: RuntimeToolRun[] };

type ToolRunDisplayGroup =
  | ToolRunGroup
  | { type: 'mixed'; id: string; groups: ToolRunGroup[]; summaryMode: ToolRunSummaryMode };

export type ToolRunGroupKind = 'inspection' | 'search' | 'shell' | 'fileMutation' | 'generic';
export type ToolRunSummaryMode = 'aggregate' | 'latest';
type AnswerApprovalHandler = (approvalId: string, input: AnswerRuntimeApprovalInput) => void | Promise<void>;

export function RuntimeToolRuns({
  runs,
  onAnswerApproval,
  summaryMode = 'aggregate',
}: {
  runs: RuntimeToolRun[];
  onAnswerApproval: AnswerApprovalHandler;
  summaryMode?: ToolRunSummaryMode;
}) {
  const visibleRuns = runs.filter(isDisplayableRuntimeToolRun);
  if (!visibleRuns.length) return null;
  const groups = compactToolRunGroups(groupToolRuns(visibleRuns), summaryMode);
  return (
    <div className="chat-tool-runs">
      {groups.map((group) => renderToolRunDisplayGroup(group, onAnswerApproval))}
    </div>
  );
}

export function RuntimeHookRuns({ runs }: { runs?: RuntimeHookRun[] }) {
  if (!runs?.length) return null;
  return (
    <div className="chat-hook-runs">
      <HookRunList runs={runs} />
    </div>
  );
}

export function isDisplayableRuntimeToolRun(run: RuntimeToolRun): boolean {
  if (run.status === 'error') return false;
  return Boolean(run.name || run.status || run.argumentsPreview || run.resultPreview);
}

function hasHookRuns(run: RuntimeToolRun): boolean {
  return Boolean(run.hookRuns?.length);
}

function renderToolRunDisplayGroup(group: ToolRunDisplayGroup, onAnswerApproval: AnswerApprovalHandler): JSX.Element {
  if (group.type === 'mixed') return <MixedToolRunGroupPanel key={group.id} group={group} onAnswerApproval={onAnswerApproval} />;
  if (group.type === 'single' && isFileOperationRun(group.run) && !hasHookRuns(group.run)) {
    return <FileMutationRunRow key={group.run.id} run={group.run} onAnswerApproval={onAnswerApproval} />;
  }
  if (group.type === 'single' && isFlatInspectionRun(group.run) && !hasHookRuns(group.run)) return <FlatToolRunRow key={group.run.id} run={group.run} />;
  if (group.type === 'single') return <ToolRunPanel key={group.run.id} run={group.run} onAnswerApproval={onAnswerApproval} />;
  return <ToolRunGroupPanel key={group.id} group={group} onAnswerApproval={onAnswerApproval} />;
}

function ToolRunPanel({
  run,
  onAnswerApproval,
}: {
  run: RuntimeToolRun;
  onAnswerApproval: AnswerApprovalHandler;
}) {
  const pendingApproval = isPendingApprovalRun(run);
  const pendingApprovalId = pendingApproval ? run.approvalId : undefined;
  const summary = toolRunSummary(run);
  if (!toolRunHasDetails(run, pendingApprovalId)) return <FlatToolRunRow run={run} />;
  const open = toolRunPanelDefaultOpen(run);
  return (
    <details className={`chat-tool-run chat-tool-run--panel chat-tool-run--${toolRunGroupKind(run)} chat-tool-run--${run.status}`} open={open}>
      <summary className="chat-tool-run__summary">
        <span className="chat-tool-run__icon">{toolRunIcon(run)}</span>
        <span className="chat-tool-run__summary-text">
          <span className="chat-tool-run__title">{summary.title}</span>
          {summary.target ? <span className="chat-tool-run__target">{summary.target}</span> : null}
        </span>
        <ToolRunStatus status={run.status} />
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
  onAnswerApproval: AnswerApprovalHandler;
}) {
  const status = toolRunGroupStatus(group.runs);
  const summary = toolRunGroupSummary(group);
  const hasPendingApproval = group.runs.some(isPendingApprovalRun);
  const visibleRuns = hasPendingApproval ? group.runs.filter(isPendingApprovalRun) : group.runs;
  const open = toolRunGroupDefaultOpen(group.kind, status, hasPendingApproval);
  const showRunTitles = group.kind !== 'shell' && group.kind !== 'fileMutation';
  const shellGroup = group.kind === 'shell';
  const fileOperationGroup = group.kind === 'fileMutation';
  const fileOperationSummary = fileOperationGroup ? fileOperationGroupSummary(group.runs) : null;
  return (
    <details className={`chat-tool-run chat-tool-run--group chat-tool-run--${group.kind} chat-tool-run--${status}`} open={open}>
      <summary className="chat-tool-run__summary">
        <span className="chat-tool-run__icon">{toolRunGroupIcon(group)}</span>
        <span className="chat-tool-run__summary-text">
          <span className="chat-tool-run__title">{summary.title}</span>
          {summary.target ? <span className="chat-tool-run__target">{summary.target}</span> : null}
          {fileOperationSummary?.changeCounts ? (
            <ChangeCounts
              additions={fileOperationSummary.changeCounts.additions}
              deletions={fileOperationSummary.changeCounts.deletions}
              showZero={fileOperationSummary.changeCounts.showZero}
            />
          ) : null}
        </span>
        <ToolRunStatus status={status} />
      </summary>
      <div
        className={`chat-tool-run__body ${
          shellGroup
            ? 'chat-tool-run__body--shell-list'
            : fileOperationGroup
              ? 'chat-tool-run__body--file-operation'
              : 'chat-tool-run__body--group'
        }`}
      >
        {group.kind === 'inspection' ? (
          <>
            <InspectionTargetList runs={visibleRuns} />
            <GroupedHookRunList runs={visibleRuns} />
          </>
        ) : fileOperationGroup ? (
          <>
            <FileOperationTargetList runs={visibleRuns} />
            <GroupedHookRunList runs={visibleRuns} />
          </>
        ) : shellGroup ? (
          visibleRuns.map((run) => <ToolRunPanel key={run.id} run={run} onAnswerApproval={onAnswerApproval} />)
        ) : (
          visibleRuns.map((run) => {
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

function MixedToolRunGroupPanel({
  group,
  onAnswerApproval,
}: {
  group: Extract<ToolRunDisplayGroup, { type: 'mixed' }>;
  onAnswerApproval: AnswerApprovalHandler;
}) {
  const runs = group.groups.flatMap(toolRunGroupRuns);
  const status = toolRunGroupStatus(runs);
  const hasPendingApproval = runs.some(isPendingApprovalRun);
  const visibleGroups = hasPendingApproval ? group.groups.map(onlyPendingApprovalGroup).filter(isToolRunGroup) : group.groups;
  const open = toolRunGroupDefaultOpen('generic', status, hasPendingApproval);
  const compactSummary = mixedToolRunGroupSummary(group.groups, group.summaryMode);
  return (
    <details className={`chat-tool-run chat-tool-run--group chat-tool-run--mixed chat-tool-run--${status}`} open={open}>
      <summary className="chat-tool-run__summary">
        <span className="chat-tool-run__icon">{mixedToolRunGroupIcon(status)}</span>
        <span className="chat-tool-run__summary-text">
          <span className="chat-tool-run__title">{compactSummary.title}</span>
          {compactSummary.target ? <span className="chat-tool-run__target">{compactSummary.target}</span> : null}
          {compactSummary.changeCounts ? (
            <ChangeCounts
              additions={compactSummary.changeCounts.additions}
              deletions={compactSummary.changeCounts.deletions}
              showZero={compactSummary.changeCounts.showZero}
            />
          ) : null}
        </span>
        <ToolRunStatus status={status} />
      </summary>
      <div className="chat-tool-run__body chat-tool-run__body--mixed-list">
        {visibleGroups.map((childGroup) => renderMixedToolRunChildGroup(childGroup, onAnswerApproval))}
      </div>
    </details>
  );
}

function renderMixedToolRunChildGroup(group: ToolRunGroup, onAnswerApproval: AnswerApprovalHandler): JSX.Element | null {
  const runs = toolRunGroupRuns(group);
  const kind = group.type === 'single' ? toolRunGroupKind(group.run) : group.kind;
  if (kind === 'fileMutation') {
    return (
      <div className="chat-tool-run__mixed-file-operation" key={toolRunGroupId(group)}>
        <FileOperationTargetList runs={runs} />
        <GroupedHookRunList runs={runs} />
      </div>
    );
  }
  return renderToolRunDisplayGroup(group, onAnswerApproval);
}

function onlyPendingApprovalGroup(group: ToolRunGroup): ToolRunGroup | null {
  const runs = toolRunGroupRuns(group).filter(isPendingApprovalRun);
  if (!runs.length) return null;
  return runs.length === 1
    ? { type: 'single', run: runs[0] }
    : {
        type: 'group',
        id: `${toolRunGroupId(group)}:pending`,
        kind: group.type === 'single' ? toolRunGroupKind(group.run) : group.kind,
        runs,
      };
}

function isToolRunGroup(group: ToolRunGroup | null): group is ToolRunGroup {
  return group !== null;
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
        <ToolRunStatus status={run.status} />
      </div>
    </div>
  );
}

function FileMutationRunRow({
  run,
  onAnswerApproval,
}: {
  run: RuntimeToolRun;
  onAnswerApproval: AnswerApprovalHandler;
}) {
  const pendingApprovalId = isPendingApprovalRun(run) ? run.approvalId : undefined;
  const target = fileOperationTarget(run);
  const error = run.status === 'error' ? formatPreview(run.resultPreview ?? '') : '';
  const totals = fileOperationChangeTotals(run);
  return (
    <div className={`chat-tool-run chat-tool-run--flat chat-tool-run--file-mutation chat-tool-run--${run.status}`}>
      <div className="chat-tool-run__summary">
        <span className="chat-tool-run__icon">{toolRunIcon(run)}</span>
        <span className="chat-tool-run__summary-text">
          <span className="chat-tool-run__file-status">
            <span>{fileOperationVerb(run)}</span>
            {target ? (
              <code className="chat-tool-run__file-target" title={target}>
                {pathBaseName(target)}
              </code>
            ) : null}
          </span>
        </span>
        <ChangeCounts additions={totals?.additions} deletions={totals?.deletions} showZero={run.status === 'running'} />
      </div>
      {pendingApprovalId ? <ApprovalActions approvalId={pendingApprovalId} availableDecisions={run.availableApprovalDecisions} onAnswerApproval={onAnswerApproval} /> : null}
      {error ? <div className="chat-tool-run__file-error">{error}</div> : null}
      <HookRunList runs={run.hookRuns} />
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
  const filePaths = useMemo(() => [...new Set(summary.files.map((file) => file.path).filter(Boolean))], [summary.files]);
  const filePathKey = useMemo(() => filePaths.join('\0'), [filePaths]);
  const [openFilePaths, setOpenFilePaths] = useState<Set<string>>(() => new Set());
  const canDiscard = Boolean(onDiscardChanges && filePaths.length && !discarded);
  useEffect(() => {
    const nextFilePaths = new Set(filePaths);
    setOpenFilePaths((current) => {
      const next = new Set([...current].filter((path) => nextFilePaths.has(path)));
      return setsEqual(current, next) ? current : next;
    });
  }, [filePathKey, filePaths]);
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
          <details className="chat-file-changes__item" key={file.path} open={openFilePaths.has(file.path)}>
            <summary
              className="chat-file-changes__row"
              onClick={(event) => {
                event.preventDefault();
                setOpenFilePaths((current) => {
                  const next = new Set(current);
                  if (next.has(file.path)) next.delete(file.path);
                  else next.add(file.path);
                  return next;
                });
              }}
            >
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
  const highlightableSource = useMemo(() => lines.map((line) => (line.type === 'gap' ? '' : line.content)).join('\n'), [lines]);
  const language = fileLanguage(file.path);
  const highlightedLines = useMemo(() => highlightedCodeLinesHtml(highlightableSource, language), [highlightableSource, language]);
  if (!lines.length) return <div className="chat-file-review__empty">暂无可展示的 diff 内容。</div>;
  return (
    <div className="chat-file-review__diff">
      {lines.map((line, index) => {
        const highlighted = line.type === 'gap' ? undefined : highlightedLines[index];
        return (
          <div
            className={`chat-file-review__line chat-file-review__line--${diffLineClass(line)}`}
            key={`${file.path}:${index}:${line.type}`}
          >
            <span className="chat-file-review__prefix">{linePrefix(line)}</span>
            <span className="chat-file-review__line-number">{lineNumber(line)}</span>
            {highlighted !== undefined ? (
              <code className={`language-${language}`} dangerouslySetInnerHTML={{ __html: highlighted || ' ' }} />
            ) : (
              <code>{line.content || ' '}</code>
            )}
          </div>
        );
      })}
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
      <RollingChangeCount className="chat-change-counts__add" prefix="+" value={add || 0} />
      <RollingChangeCount className="chat-change-counts__del" prefix="-" value={del || 0} />
    </span>
  );
}

function RollingChangeCount({ className, prefix, value }: { className: string; prefix: string; value: number }) {
  const previousValueRef = useRef(value);
  const [roll, setRoll] = useState<{
    current: number;
    direction: 'up' | 'down';
    previous: number | null;
    version: number;
  }>({
    current: value,
    direction: 'up',
    previous: null,
    version: 0,
  });

  useEffect(() => {
    const previous = previousValueRef.current;
    if (previous === value) return;
    previousValueRef.current = value;
    setRoll((currentRoll) => ({
      current: value,
      direction: value >= previous ? 'up' : 'down',
      previous,
      version: currentRoll.version + 1,
    }));
  }, [value]);

  const rolling = roll.previous !== null && roll.previous !== roll.current;
  const values = rolling
    ? roll.direction === 'up'
      ? [roll.previous, roll.current]
      : [roll.current, roll.previous]
    : [roll.current];

  return (
    <span className={`${className} chat-change-counts__item`}>
      <span className="chat-change-counts__sign">{prefix}</span>
      <span className={`chat-change-counts__number ${rolling ? `is-rolling is-${roll.direction}` : ''}`}>
        <span
          className="chat-change-counts__number-stack"
          key={roll.version}
          onAnimationEnd={() => {
            setRoll((currentRoll) => (currentRoll.previous === null ? currentRoll : { ...currentRoll, previous: null }));
          }}
        >
          {values.map((item, index) => (
            <span key={`${roll.version}:${index}:${item}`}>{item}</span>
          ))}
        </span>
      </span>
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

function fileOperationChangeTotals(run: RuntimeToolRun): { additions: number; deletions: number; showZero: boolean } | null {
  const resultTotals = fileMutationChangeTotals(run);
  if (resultTotals) return { ...resultTotals, showZero: true };
  const argumentTotals = fileOperationChangeTotalsFromArguments(run);
  if (argumentTotals) return { ...argumentTotals, showZero: true };
  return run.status === 'running' || run.status === 'pending_approval' ? { additions: 0, deletions: 0, showZero: true } : null;
}

function fileOperationGroupChangeTotals(runs: RuntimeToolRun[]): { additions: number; deletions: number; showZero: boolean } | null {
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
  const active = runs.some((run) => run.status === 'running' || run.status === 'pending_approval');
  return active ? { additions: 0, deletions: 0, showZero: true } : null;
}

function fileOperationChangeTotalsFromArguments(run: RuntimeToolRun): { additions: number; deletions: number } | null {
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

function fileOperationDiffTotalsFromValue(value: unknown): { additions: number; deletions: number } | null {
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

function diffLineClass(line: RuntimeFileDiffLine): string {
  if (line.type === 'added') return 'add';
  if (line.type === 'removed') return 'del';
  return line.type;
}

function linePrefix(line: RuntimeFileDiffLine): string {
  if (line.type === 'added' || line.type === 'removed') return '';
  if (line.type === 'gap') return '...';
  return ' ';
}

function lineNumber(line: RuntimeFileDiffLine): string {
  const value = line.type === 'removed' ? line.oldLine : line.newLine ?? line.oldLine;
  return value ? String(value) : '';
}

function setsEqual<T>(left: Set<T>, right: Set<T>): boolean {
  if (left.size !== right.size) return false;
  for (const item of left) {
    if (!right.has(item)) return false;
  }
  return true;
}

function InspectionTargetList({ runs }: { runs: RuntimeToolRun[] }) {
  const entries = inspectionEntries(runs);
  if (!entries.length) return null;
  return (
    <ul className="chat-tool-run__inspection-list">
      {entries.map((entry) => (
        <li className="chat-tool-run__inspection-item" key={`${entry.kind}:${entry.target}`}>
          <span>{inspectionEntryLabel(entry.kind)}</span>
          <code title={entry.target}>{entry.target}</code>
        </li>
      ))}
    </ul>
  );
}

function FileOperationTargetList({ runs }: { runs: RuntimeToolRun[] }) {
  const entries = fileOperationEntries(runs);
  if (!entries.length) return null;
  return (
    <ul className="chat-tool-run__inspection-list chat-tool-run__file-operation-list">
      {entries.map((entry) => (
        <li className="chat-tool-run__inspection-item" key={`${entry.action}:${entry.path}`}>
          <span>{fileOperationActionLabel(entry.action)}</span>
          <code title={entry.path}>{entry.path}</code>
          <ChangeCounts additions={entry.additions} deletions={entry.deletions} showZero={entry.hasChangeCounts} />
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
  onAnswerApproval: AnswerApprovalHandler;
  pendingApprovalId?: string;
}) {
  const execPolicySummary = execPolicyApprovalSummary(run);
  const permissionSummary = permissionApprovalSummary(run);
  const networkSummary = networkApprovalSummary(run);
  const hookRuns = <HookRunList runs={run.hookRuns} />;
  if (isShellRun(run)) {
    return (
      <>
        <ShellTerminalResult run={run} />
        {execPolicySummary ? <ToolPreview label="命令策略" value={execPolicySummary} /> : null}
        {networkSummary ? <ToolPreview label="网络访问" value={networkSummary} /> : null}
        {permissionSummary ? <ToolPreview label="请求权限" value={permissionSummary} /> : null}
        {hookRuns}
        {pendingApprovalId ? <ApprovalActions approvalId={pendingApprovalId} availableDecisions={run.availableApprovalDecisions} onAnswerApproval={onAnswerApproval} /> : null}
      </>
    );
  }
  if (toolRunGroupKind(run) === 'inspection') {
    return (
      <>
        <InspectionTargetList runs={[run]} />
        {execPolicySummary ? <ToolPreview label="命令策略" value={execPolicySummary} /> : null}
        {networkSummary ? <ToolPreview label="网络访问" value={networkSummary} /> : null}
        {permissionSummary ? <ToolPreview label="请求权限" value={permissionSummary} /> : null}
        {hookRuns}
        {pendingApprovalId ? <ApprovalActions approvalId={pendingApprovalId} availableDecisions={run.availableApprovalDecisions} onAnswerApproval={onAnswerApproval} /> : null}
      </>
    );
  }
  if (isFileOperationRun(run)) {
    return (
      <>
        {run.status === 'error' && run.resultPreview ? <div className="chat-tool-run__file-error">{formatPreview(run.resultPreview)}</div> : null}
        {execPolicySummary ? <ToolPreview label="命令策略" value={execPolicySummary} /> : null}
        {networkSummary ? <ToolPreview label="网络访问" value={networkSummary} /> : null}
        {permissionSummary ? <ToolPreview label="请求权限" value={permissionSummary} /> : null}
        {hookRuns}
        {pendingApprovalId ? <ApprovalActions approvalId={pendingApprovalId} availableDecisions={run.availableApprovalDecisions} onAnswerApproval={onAnswerApproval} /> : null}
      </>
    );
  }
  const diagnostic = genericToolRunDiagnostic(run);
  return (
    <>
      {execPolicySummary ? <ToolPreview label="命令策略" value={execPolicySummary} /> : null}
      {networkSummary ? <ToolPreview label="网络访问" value={networkSummary} /> : null}
      {permissionSummary ? <ToolPreview label="请求权限" value={permissionSummary} /> : null}
      {diagnostic ? <ToolPreview label={run.status === 'rejected' ? '已拒绝' : '错误'} value={diagnostic} /> : null}
      {hookRuns}
      {pendingApprovalId ? <ApprovalActions approvalId={pendingApprovalId} availableDecisions={run.availableApprovalDecisions} onAnswerApproval={onAnswerApproval} /> : null}
    </>
  );
}

function GroupedHookRunList({ runs }: { runs: RuntimeToolRun[] }) {
  const runsWithHooks = runs.filter(hasHookRuns);
  if (!runsWithHooks.length) return null;
  return (
    <div className="chat-tool-run__hook-groups">
      {runsWithHooks.map((run) => {
        const summary = toolRunSummary(run);
        return (
          <div className="chat-tool-run__hook-group" key={`${run.id}:hooks`}>
            <div className="chat-tool-run__hook-group-title">
              <span>{summary.title}</span>
              {summary.target ? <code>{summary.target}</code> : null}
            </div>
            <HookRunList runs={run.hookRuns} />
          </div>
        );
      })}
    </div>
  );
}

function HookRunList({ runs }: { runs?: RuntimeHookRun[] }) {
  if (!runs?.length) return null;
  return (
    <div className="chat-tool-run__hooks">
      {runs.map((run) => (
        <div className={`chat-tool-run__hook chat-tool-run__hook--${run.status}`} key={run.id}>
          <span className="chat-tool-run__hook-dot" />
          <span className="chat-tool-run__hook-main">
            <span className="chat-tool-run__hook-title">{hookRunTitle(run)}</span>
            {run.message ? <span className="chat-tool-run__hook-message">{run.message}</span> : null}
            <HookOutputEntryList entries={run.entries} />
          </span>
          {hookRunStatusText(run.status) ? <span className="chat-tool-run__hook-status">{hookRunStatusText(run.status)}</span> : null}
        </div>
      ))}
    </div>
  );
}

function HookOutputEntryList({ entries }: { entries?: RuntimeHookRun['entries'] }) {
  if (!entries?.length) return null;
  return (
    <span className="chat-tool-run__hook-entries">
      {entries.map((entry, index) => (
        <span className={`chat-tool-run__hook-entry chat-tool-run__hook-entry--${entry.kind}`} key={`${entry.kind}:${index}`}>
          {hookOutputEntryLabel(entry.kind)} {entry.text}
        </span>
      ))}
    </span>
  );
}

function hookOutputEntryLabel(kind: NonNullable<RuntimeHookRun['entries']>[number]['kind']): string {
  if (kind === 'warning') return '警告';
  if (kind === 'stop') return '停止';
  if (kind === 'feedback') return '反馈';
  if (kind === 'context') return '上下文';
  return '错误';
}

function hookRunTitle(run: RuntimeHookRun): string {
  const label = hookEventLabel(run.eventName);
  if (run.statusMessage) return `${label}：${run.statusMessage}`;
  if (run.matcher) return `${label} · ${run.matcher}`;
  return label;
}

function hookEventLabel(eventName: RuntimeHookRun['eventName']): string {
  if (eventName === 'PreToolUse') return '执行前 hook';
  if (eventName === 'PermissionRequest') return '授权 hook';
  if (eventName === 'PostToolUse') return '执行后 hook';
  if (eventName === 'PreCompact') return '压缩前 hook';
  if (eventName === 'PostCompact') return '压缩后 hook';
  if (eventName === 'SessionStart') return '会话开始 hook';
  if (eventName === 'SubagentStart') return '子任务开始 hook';
  if (eventName === 'UserPromptSubmit') return '消息提交 hook';
  if (eventName === 'SubagentStop') return '子任务结束 hook';
  if (eventName === 'Stop') return '结束 hook';
  return 'hook';
}

function hookRunStatusText(status: RuntimeHookRun['status']): string {
  if (status === 'running') return '运行中';
  if (status === 'blocked') return '已拦截';
  if (status === 'stopped') return '已停止';
  if (status === 'failed') return '失败';
  return '';
}

function toolRunHasDetails(run: RuntimeToolRun, pendingApprovalId?: string): boolean {
  if (isShellRun(run) || toolRunGroupKind(run) === 'inspection' || isFileOperationRun(run)) return true;
  if (pendingApprovalId) return true;
  if (run.proposedExecPolicyAmendment?.length) return true;
  if (run.networkApprovalContext) return true;
  if (run.permissionApprovalContext) return true;
  if (run.hookRuns?.length) return true;
  return Boolean(genericToolRunDiagnostic(run));
}

function execPolicyApprovalSummary(run: RuntimeToolRun): string {
  const prefix = run.proposedExecPolicyAmendment?.filter(Boolean) ?? [];
  return prefix.length ? `allow prefix: ${prefix.join(' ')}` : '';
}

function networkApprovalSummary(run: RuntimeToolRun): string {
  const context = run.networkApprovalContext;
  if (!context) return '';
  const allowAmendments = run.proposedNetworkPolicyAmendments
    ?.filter((item) => item.action === 'allow' && item.host)
    .map((item) => item.host);
  const denyAmendments = run.proposedNetworkPolicyAmendments
    ?.filter((item) => item.action === 'deny' && item.host)
    .map((item) => item.host);
  return [
    `target: ${context.target}`,
    `protocol: ${context.protocol}`,
    allowAmendments?.length ? `policy allow: ${[...new Set(allowAmendments)].join(', ')}` : '',
    denyAmendments?.length ? `policy deny: ${[...new Set(denyAmendments)].join(', ')}` : '',
  ].filter(Boolean).join('\n');
}

function permissionApprovalSummary(run: RuntimeToolRun): string {
  const context = run.permissionApprovalContext;
  if (!context) return '';
  const granted = isRecord(context.grantedPermissions) ? context.grantedPermissions : {};
  const network = isRecord(granted.network) && granted.network.enabled === true;
  const readRoots = permissionFileRoots(granted.file_system ?? granted.fileSystem, 'read');
  const writeRoots = permissionWriteRoots(granted.file_system ?? granted.fileSystem);
  const lines = [
    context.cwd ? `cwd: ${context.cwd}` : '',
    network ? 'network: enabled' : '',
    readRoots.length ? `read: ${readRoots.slice(0, 5).join(', ')}${readRoots.length > 5 ? ` +${readRoots.length - 5}` : ''}` : '',
    writeRoots.length ? `write: ${writeRoots.slice(0, 5).join(', ')}${writeRoots.length > 5 ? ` +${writeRoots.length - 5}` : ''}` : '',
  ].filter(Boolean);
  return lines.join('\n');
}

function permissionWriteRoots(value: unknown): string[] {
  return permissionFileRoots(value, 'write');
}

function permissionFileRoots(value: unknown, access: 'read' | 'write'): string[] {
  const fileSystem = isRecord(value) ? value : {};
  const roots = new Set<string>();
  const legacyRoots = access === 'write' ? fileSystem.write : fileSystem.read;
  if (Array.isArray(legacyRoots)) {
    for (const item of legacyRoots) {
      const root = stringField(item);
      if (root) roots.add(root);
    }
  }
  if (Array.isArray(fileSystem.entries)) {
    for (const item of fileSystem.entries) {
      if (!isRecord(item) || item.access !== access) continue;
      const pathValue = isRecord(item.path) ? stringField(item.path.path) : stringField(item.path);
      if (pathValue) roots.add(pathValue);
    }
  }
  return [...roots];
}

function ApprovalActions({
  approvalId,
  availableDecisions,
  onAnswerApproval,
}: {
  approvalId: string;
  availableDecisions?: RuntimeApprovalAvailableDecision[];
  onAnswerApproval: AnswerApprovalHandler;
}) {
  const [submittingDecisionKey, setSubmittingDecisionKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submit = async (decision: RuntimeApprovalAvailableDecision) => {
    if (submittingDecisionKey) return;
    const decisionKey = approvalDecisionKey(decision);
    setSubmittingDecisionKey(decisionKey);
    setError(null);
    try {
      await onAnswerApproval(approvalId, approvalInputFromDecision(decision));
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      setSubmittingDecisionKey(null);
    }
  };
  const decisions = availableDecisions?.length ? availableDecisions : defaultApprovalDecisions();
  return (
    <div className="chat-tool-run__approval">
      <div className="chat-tool-run__actions">
        {decisions.map((decision) => (
          <button
            key={approvalDecisionKey(decision)}
            type="button"
            disabled={Boolean(submittingDecisionKey)}
            onClick={() => void submit(decision)}
          >
            {submittingDecisionKey === approvalDecisionKey(decision) ? `${approvalDecisionLabel(decision)}中` : approvalDecisionLabel(decision)}
          </button>
        ))}
      </div>
      {error ? <div className="chat-tool-run__action-error">{error}</div> : null}
    </div>
  );
}

function defaultApprovalDecisions(): RuntimeApprovalAvailableDecision[] {
  return [
    { type: 'approve' },
    { type: 'approve_for_session' },
    { type: 'reject' },
  ];
}

function approvalDecisionKey(decision: RuntimeApprovalAvailableDecision): string {
  if (decision.type === 'approve_exec_policy_amendment') return `${decision.type}:${decision.proposedExecPolicyAmendment.join(' ')}`;
  if (decision.type === 'approve_network_policy_amendment') return `${decision.type}:${decision.networkPolicyAmendment.host}:${decision.networkPolicyAmendment.action}`;
  return decision.type;
}

function approvalDecisionLabel(decision: RuntimeApprovalAvailableDecision): string {
  if (decision.type === 'approve') return '允许';
  if (decision.type === 'approve_for_turn_with_strict_auto_review') return '本轮允许并严格复核';
  if (decision.type === 'approve_for_session') return '本会话允许';
  if (decision.type === 'approve_persistently') return '永久允许';
  if (decision.type === 'approve_exec_policy_amendment') return '允许命令前缀';
  if (decision.type === 'approve_network_policy_amendment') return decision.networkPolicyAmendment.action === 'deny' ? '拒绝并记住网络策略' : '允许网络策略';
  if (decision.type === 'cancel') return '取消本轮';
  return '拒绝';
}

function approvalInputFromDecision(decision: RuntimeApprovalAvailableDecision): AnswerRuntimeApprovalInput {
  if (decision.type === 'approve_exec_policy_amendment') {
    return { decision: decision.type, proposedExecPolicyAmendment: decision.proposedExecPolicyAmendment };
  }
  if (decision.type === 'approve_network_policy_amendment') {
    return { decision: decision.type, networkPolicyAmendment: decision.networkPolicyAmendment };
  }
  return { decision: decision.type };
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

function compactToolRunGroups(groups: ToolRunGroup[], summaryMode: ToolRunSummaryMode): ToolRunDisplayGroup[] {
  return groups.length > 1
    ? [{ type: 'mixed', id: `mixed:${groups.map(toolRunGroupId).join(':')}`, groups, summaryMode }]
    : groups;
}

function toolRunGroupId(group: ToolRunGroup): string {
  return group.type === 'single' ? group.run.id : group.id;
}

function toolRunGroupRuns(group: ToolRunGroup): RuntimeToolRun[] {
  return group.type === 'single' ? [group.run] : group.runs;
}

type CompactToolRunSummary = {
  title: string;
  target?: string;
  changeCounts?: { additions: number; deletions: number; showZero: boolean };
};

function mixedToolRunGroupSummary(groups: ToolRunGroup[], summaryMode: ToolRunSummaryMode): CompactToolRunSummary {
  if (summaryMode === 'latest') return compactToolRunGroupSummary(groups.at(-1));
  return { title: mixedToolRunGroupAggregateTitle(groups) };
}

function compactToolRunGroupSummary(group: ToolRunGroup | undefined): CompactToolRunSummary {
  if (!group) return { title: '' };
  const runs = toolRunGroupRuns(group);
  const kind = group.type === 'single' ? toolRunGroupKind(group.run) : group.kind;
  if (kind === 'fileMutation') return fileOperationGroupSummary(runs);
  if (group.type === 'single') return toolRunSummary(group.run);
  if (kind === 'shell' && runs.length === 1) return toolRunSummary(runs[0]);
  return { title: mixedToolRunGroupPart(group) };
}

function mixedToolRunGroupAggregateTitle(groups: ToolRunGroup[]): string {
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

function mixedToolRunBucketSummary(kind: ToolRunGroupKind | 'webContent', runs: RuntimeToolRun[]): string {
  const status = toolRunGroupStatus(runs);
  if (kind === 'fileMutation') return fileOperationGroupSummary(runs).title;
  if (kind === 'inspection') {
    const parts = inspectionSummaryParts(inspectionEntries(runs));
    return parts.length ? parts.join('，') : inspectionGroupSummary(runs).title;
  }
  if (kind === 'shell') return shellCountSummary(runs, status);
  if (kind === 'search') return searchCountSummary(runs, status);
  if (kind === 'webContent') return webContentGroupSummary(runs)?.title ?? '';
  const name = toolDisplayName(runs[0]?.name ?? '工具');
  if (status === 'running' || status === 'pending_approval') return `正在使用 ${name}`;
  if (status === 'rejected') return `已拒绝 ${name}`;
  return `已使用 ${runs.length} 次 ${name}`;
}

function mixedToolRunGroupPart(group: ToolRunGroup): string {
  const runs = toolRunGroupRuns(group);
  const kind = group.type === 'single' ? toolRunGroupKind(group.run) : group.kind;
  const status = toolRunGroupStatus(runs);
  if (kind === 'fileMutation') return fileOperationGroupSummary(runs).title;
  if (kind === 'shell') return shellCountSummary(runs, status);
  if (kind === 'inspection') return inspectionGroupSummary(runs).title;
  if (kind === 'search') return searchCountSummary(runs, status);
  const webContentSummary = webContentGroupSummary(runs);
  if (webContentSummary) return webContentSummary.title;
  const name = toolDisplayName(runs[0]?.name ?? '工具');
  if (status === 'running' || status === 'pending_approval') return `正在使用 ${name}`;
  if (status === 'rejected') return `已拒绝 ${name}`;
  return `已使用 ${runs.length} 次 ${name}`;
}

function shellCountSummary(runs: RuntimeToolRun[], status: RuntimeToolRun['status']): string {
  if (status === 'running' || status === 'pending_approval') return `正在运行 ${runs.length} 条命令`;
  if (status === 'rejected') return `已拒绝 ${runs.length} 条命令`;
  return `已运行 ${runs.length} 条命令`;
}

function searchCountSummary(runs: RuntimeToolRun[], status: RuntimeToolRun['status']): string {
  if (status === 'running' || status === 'pending_approval') return `正在搜索 ${runs.length} 次代码`;
  if (status === 'rejected') return `已拒绝 ${runs.length} 次搜索`;
  return `已搜索 ${runs.length} 次代码`;
}

function mixedToolRunGroupIcon(status: RuntimeToolRun['status']) {
  if (status === 'pending_approval') return <ShieldAlert size={14} />;
  if (status === 'running') return <Clock3 size={14} />;
  if (status === 'rejected') return <AlertCircle size={14} />;
  return <CheckCircle2 size={14} />;
}

function isShellRun(run: RuntimeToolRun): boolean {
  return toolRunGroupKind(run) === 'shell';
}

function isFileOperationRun(run: RuntimeToolRun): boolean {
  return isRuntimeFileMutationRun(run) || run.name === 'plan_file_changes' || run.name === 'begin_file_change';
}

function isPendingApprovalRun(run: RuntimeToolRun): boolean {
  return run.status === 'pending_approval' && run.approvalStatus !== 'approved' && run.approvalStatus !== 'rejected';
}

function isFlatInspectionRun(run: RuntimeToolRun): boolean {
  return toolRunGroupKind(run) === 'inspection' && run.status !== 'pending_approval';
}

export function toolRunPanelDefaultOpen(run: RuntimeToolRun): boolean {
  if (isPendingApprovalRun(run)) return true;
  if (isShellRun(run)) return run.status === 'error' || run.status === 'rejected';
  return run.status === 'error' || run.status === 'rejected';
}

export function toolRunGroupDefaultOpen(_kind: ToolRunGroupKind, status: RuntimeToolRun['status'], hasPendingApproval: boolean): boolean {
  return hasPendingApproval || status === 'error' || status === 'rejected';
}

function toolRunGroupingKey(run: RuntimeToolRun): string {
  const kind = toolRunGroupKind(run);
  return kind === 'generic' ? `${kind}:${run.name}` : kind;
}

function toolRunGroupKind(run: RuntimeToolRun): ToolRunGroupKind {
  if (run.name === 'workspace_read_file' || run.name === 'workspace_list_directory' || run.name === 'read_file' || run.name === 'list_directory' || run.name === 'find_files' || run.name === 'read_diff' || run.name === 'git_status') return 'inspection';
  if (isFileOperationRun(run)) return 'fileMutation';
  if (run.name === 'workspace_search_text' || run.name === 'search_text') return 'search';
  if (run.name.includes('shell') || run.name === 'run_shell_command' || run.name === 'read_shell_process' || run.name === 'exec_command' || run.name === 'write_stdin') return 'shell';
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
  if (group.kind === 'fileMutation') return fileOperationGroupSummary(group.runs);
  const webContentSummary = webContentGroupSummary(group.runs);
  if (webContentSummary) return webContentSummary;
  const status = toolRunGroupStatus(group.runs);
  const name = toolDisplayName(group.runs[0]?.name ?? '工具');
  if (status === 'running' || status === 'pending_approval') return { title: `正在使用 ${name}` };
  if (status === 'error') return { title: `${name} 调用失败` };
  return { title: `已使用 ${group.runs.length} 次 ${name}` };
}

function inspectionGroupSummary(runs: RuntimeToolRun[]): { title: string; target?: string } {
  const status = toolRunGroupStatus(runs);
  const active = runs.findLast((run) => run.status === 'running' || run.status === 'pending_approval') ?? runs.at(-1);
  const activeEntry = active ? inspectionEntryFromRun(active) : null;
  const activeTarget = activeEntry?.target ?? '';
  if (status === 'running' || status === 'pending_approval') {
    return { title: activeEntry ? inspectionRunningTitle(activeEntry.kind) : '正在查看文件/目录', target: activeTarget };
  }
  if (status === 'error') return { title: '查看文件/目录失败', target: activeTarget };
  const parts = inspectionSummaryParts(inspectionEntries(runs));
  if (parts.length) return { title: parts.join('，') };
  return { title: activeEntry ? inspectionCompleteTitle(activeEntry.kind) : '已查看文件/目录', target: activeTarget };
}

function shellGroupSummary(runs: RuntimeToolRun[]): { title: string; target?: string } {
  const status = toolRunGroupStatus(runs);
  const active = runs.findLast((run) => run.status === 'running' || run.status === 'pending_approval') ?? runs.at(-1);
  const command = active ? shellCommand(active) : '';
  if (status === 'running' || status === 'pending_approval') return { title: command ? `正在运行 ${command}` : '正在运行命令' };
  if (status === 'error') return { title: command ? `命令运行失败 ${command}` : '命令运行失败' };
  return { title: `已运行 ${runs.length} 条命令` };
}

function searchGroupSummary(runs: RuntimeToolRun[]): { title: string; target?: string } {
  const status = toolRunGroupStatus(runs);
  const active = runs.findLast((run) => run.status === 'running' || run.status === 'pending_approval') ?? runs.at(-1);
  const query = active ? toolRunTarget(active) : '';
  if (status === 'running' || status === 'pending_approval') return { title: '正在搜索代码', target: query };
  if (status === 'error') return { title: '搜索代码失败', target: query };
  if (runs.length > 1) return { title: `已搜索 ${runs.length} 次代码` };
  return { title: '已搜索代码', target: query };
}

function webContentGroupSummary(runs: RuntimeToolRun[]): { title: string; target?: string } | null {
  if (!runs.length || runs.some((run) => !isWebContentRun(run))) return null;
  const status = toolRunGroupStatus(runs);
  const active = runs.findLast((run) => run.status === 'running' || run.status === 'pending_approval') ?? runs.at(-1);
  const target = active ? toolRunTarget(active) : '';
  if (status === 'running' || status === 'pending_approval') return { title: '正在获取网页', target };
  if (status === 'error') return { title: '获取网页失败', target };
  if (status === 'rejected') return { title: '已拒绝获取网页', target };
  if (runs.length > 1) return { title: `已获取 ${runs.length} 个网页` };
  return { title: '已获取网页', target };
}

type InspectionEntryKind = 'file' | 'directory' | 'fileSearch' | 'gitStatus';
type InspectionEntry = { target: string; kind: InspectionEntryKind };

function inspectionEntries(runs: RuntimeToolRun[]): InspectionEntry[] {
  const entries = new Map<string, InspectionEntry>();
  for (const run of runs) {
    const entry = inspectionEntryFromRun(run);
    if (!entry) continue;
    const key = `${entry.kind}:${entry.target}`;
    if (!entries.has(key)) entries.set(key, entry);
  }
  return [...entries.values()];
}

function inspectionEntryFromRun(run: RuntimeToolRun): InspectionEntry | null {
  const target = toolRunTarget(run) || (run.name === 'workspace_list_directory' || run.name === 'list_directory' || run.name === 'git_status' ? '.' : '');
  if (!target) return null;
  return {
    target,
    kind: inspectionEntryKind(run),
  };
}

function inspectionEntryKind(run: RuntimeToolRun): InspectionEntryKind {
  if (run.name === 'workspace_list_directory' || run.name === 'list_directory') return 'directory';
  if (run.name === 'find_files') return 'fileSearch';
  if (run.name === 'git_status') return 'gitStatus';
  return 'file';
}

function inspectionSummaryParts(entries: InspectionEntry[]): string[] {
  const counts = new Map<InspectionEntryKind, number>();
  const order: InspectionEntryKind[] = [];
  for (const entry of entries) {
    if (!counts.has(entry.kind)) order.push(entry.kind);
    counts.set(entry.kind, (counts.get(entry.kind) ?? 0) + 1);
  }
  return order.map((kind) => inspectionSummaryPart(kind, counts.get(kind) ?? 0)).filter(Boolean);
}

function inspectionSummaryPart(kind: InspectionEntryKind, count: number): string {
  if (kind === 'directory') return `已查看 ${count} 个目录`;
  if (kind === 'fileSearch') return `已查找 ${count} 次文件`;
  if (kind === 'gitStatus') return '已查看 Git 状态';
  return `已读取 ${count} 个文件`;
}

function inspectionEntryLabel(kind: InspectionEntryKind): string {
  if (kind === 'directory') return '已查看目录';
  if (kind === 'fileSearch') return '已查找文件';
  if (kind === 'gitStatus') return '已查看状态';
  return '已读取文件';
}

function inspectionRunningTitle(kind: InspectionEntryKind): string {
  if (kind === 'directory') return '正在查看目录';
  if (kind === 'fileSearch') return '正在查找文件';
  if (kind === 'gitStatus') return '正在查看 Git 状态';
  return '正在读取文件';
}

function inspectionCompleteTitle(kind: InspectionEntryKind): string {
  if (kind === 'directory') return '已查看目录';
  if (kind === 'fileSearch') return '已查找文件';
  if (kind === 'gitStatus') return '已查看 Git 状态';
  return '已读取文件';
}

function toolRunTarget(run: RuntimeToolRun): string {
  const args = recordFromJson(run.argumentsPreview);
  const url = stringField(args.url ?? args.uri ?? args.href);
  if (url) return compactUrlTarget(url);
  return stringField(args.command ?? args.query ?? args.path ?? args.file_path ?? args.target_path ?? args.file ?? args.process_id ?? args.processId);
}

function fileOperationTarget(run: RuntimeToolRun): string {
  return fileMutationDisplayPath(run) || fileOperationTargetFromArguments(run) || toolRunTarget(run) || fileMutationPathFromReason(run.approvalReason);
}

function fileOperationTargetFromArguments(run: RuntimeToolRun): string {
  const args = recordFromJson(run.argumentsPreview);
  const direct = stringField(args.path ?? args.file_path ?? args.target_path ?? args.file);
  if (direct) return direct;

  const currentFile = args.current_file_change;
  if (isRecord(currentFile)) {
    const currentPath = stringField(currentFile.file_path ?? currentFile.path);
    if (currentPath) return currentPath;
  }

  const plannedFiles = Array.isArray(args.files) ? args.files : Array.isArray(args.changes) ? args.changes : [];
  const plannedPaths = plannedFiles
    .map((item) => (isRecord(item) ? stringField(item.file_path ?? item.path) : ''))
    .filter(Boolean);
  if (plannedPaths.length === 1) return plannedPaths[0];
  if (plannedPaths.length > 1) return `${plannedPaths.length} 个文件`;
  return '';
}

function fileOperationVerb(run: RuntimeToolRun): string {
  if (run.name === 'plan_file_changes') return runningAware(run, '规划文件改动', '已规划文件改动');
  if (run.name === 'begin_file_change') return runningAware(run, '准备写入', '已准备写入');
  const action = fileOperationAction(run);
  const created = action === 'created';
  const deleted = action === 'deleted';
  if (run.status === 'pending_approval') return '等待授权：写入';
  if (run.status === 'running') return '正在写入';
  if (run.status === 'error') return created ? '生成失败' : deleted ? '删除失败' : '编辑失败';
  if (run.status === 'rejected') return '已拒绝写入';
  if (created) return '已生成';
  if (deleted) return '已删除';
  return '已编辑';
}

type FileOperationRunSummary = {
  title: string;
  target?: string;
  changeCounts?: { additions: number; deletions: number; showZero: boolean };
};

function fileOperationGroupSummary(runs: RuntimeToolRun[]): FileOperationRunSummary {
  const status = toolRunGroupStatus(runs);
  const active = runs.findLast((run) => run.status === 'running' || run.status === 'pending_approval') ?? runs.at(-1);
  const entries = fileOperationEntries(runs);
  const activeTarget = active ? fileOperationTarget(active) : '';
  const fallbackTarget = activeTarget || (entries.length === 1 ? entries[0]?.path : entries.length > 1 ? `${entries.length} 个文件` : '');
  const changeCounts = fileOperationGroupChangeTotals(runs) ?? undefined;
  if (status === 'running' || status === 'pending_approval') {
    return { title: active ? fileOperationVerb(active) : '正在处理文件', target: fallbackTarget, changeCounts };
  }
  if (status === 'error') return { title: '文件操作失败', target: fallbackTarget, changeCounts };
  if (status === 'rejected') return { title: '已拒绝文件操作', target: fallbackTarget, changeCounts };

  const hasAppliedMutation = runs.some(isRuntimeFileMutationRun);
  if (!hasAppliedMutation) {
    if (runs.some((run) => run.name === 'begin_file_change')) {
      return entries.length > 1
        ? { title: `已准备写入 ${entries.length} 个文件`, changeCounts }
        : { title: '已准备写入', target: entries[0]?.path, changeCounts };
    }
    return entries.length > 1
      ? { title: `已规划 ${entries.length} 个文件改动`, changeCounts }
      : { title: '已规划文件改动', target: entries[0]?.path, changeCounts };
  }

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
  return { title: parts.length ? parts.join('，') : `已处理 ${runs.length} 个文件操作`, changeCounts };
}

type FileOperationAction = 'created' | 'modified' | 'deleted';
type FileOperationEntry = {
  action: FileOperationAction;
  additions?: number;
  deletions?: number;
  hasChangeCounts?: boolean;
  showZeroChangeCounts?: boolean;
  path: string;
  priority: number;
};

function fileOperationEntries(runs: RuntimeToolRun[]): FileOperationEntry[] {
  const byPath = new Map<string, FileOperationEntry>();
  for (const run of runs) {
    const priority = isRuntimeFileMutationRun(run) ? 2 : run.name === 'begin_file_change' ? 1 : 0;
    const changes = fileChangesFromToolRun(run);
    const entries = changes.length
      ? changes.map((change) => ({
          action: normalizeFileOperationAction(change.action),
          additions: change.additions,
          deletions: change.deletions,
          hasChangeCounts: true,
          showZeroChangeCounts: true,
          path: change.path,
          priority,
        }))
      : [fileOperationEntryFromRun(run, priority)];

    for (const entry of entries) {
      if (!entry.path) continue;
      const key = normalizeFileOperationPath(entry.path);
      const current = byPath.get(key);
      if (!current || entry.priority >= current.priority) byPath.set(key, entry);
    }
  }
  return [...byPath.values()];
}

function fileOperationEntryFromRun(run: RuntimeToolRun, priority: number): FileOperationEntry {
  const totals = fileOperationChangeTotals(run);
  return {
    action: fileOperationAction(run),
    additions: totals?.additions,
    deletions: totals?.deletions,
    hasChangeCounts: Boolean(totals),
    showZeroChangeCounts: totals?.showZero,
    path: fileOperationTarget(run),
    priority,
  };
}

function fileOperationAction(run: RuntimeToolRun): FileOperationAction {
  const args = recordFromJson(run.argumentsPreview);
  const action = stringField(fileChangeFromToolRun(run)?.action ?? args.action);
  if (action) return normalizeFileOperationAction(action);
  if (run.name === 'delete_file') return 'deleted';
  return 'modified';
}

function normalizeFileOperationAction(value: unknown): FileOperationAction {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'created' || normalized === 'create' || normalized === 'new') return 'created';
  if (normalized === 'deleted' || normalized === 'delete' || normalized === 'remove' || normalized === 'removed') return 'deleted';
  return 'modified';
}

function normalizeFileOperationPath(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/\/+$/u, '').toLowerCase();
}

function fileOperationActionLabel(action: FileOperationAction): string {
  if (action === 'created') return '创建';
  if (action === 'deleted') return '删除';
  return '编辑';
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
  const url = stringField(args.url ?? args.uri ?? args.href);

  if (isWebContentRun(run, url)) return { title: runningAware(run, '获取网页', '已获取网页'), target: compactUrlTarget(url) };
  if (name === 'workspace_read_file' || name === 'read_file') return { title: runningAware(run, '读取文件', '已读取文件'), target: path };
  if (name === 'workspace_list_directory' || name === 'list_directory') return { title: runningAware(run, '查看目录', '已查看目录'), target: path || '.' };
  if (name === 'find_files') return { title: runningAware(run, '查找文件', '已查找文件'), target: query || path };
  if (name === 'workspace_search_text' || name === 'search_text') return { title: runningAware(run, '搜索代码', '已搜索代码'), target: query };
  if (isFileOperationRun(run)) return { title: fileOperationVerb(run), target: fileOperationTarget(run) || path };
  if (name === 'run_shell_command') return shellRunSummary(run, command);
  if (name === 'read_shell_process') return { title: runningAware(run, '读取命令输出', '已读取命令输出'), target: stringField(args.process_id ?? args.processId) };
  if (name === 'remember_memory') return { title: runningAware(run, '保存记忆', '已保存记忆') };
  if (name === 'recall_memory') return { title: runningAware(run, '检索记忆', '已检索记忆'), target: query };
  return { title: runningAware(run, toolDisplayName(name), `已使用 ${toolDisplayName(name)}`) };
}

function shellRunSummary(run: RuntimeToolRun, command: string): { title: string; target?: string } {
  const displayCommand = command || shellCommand(run);
  if (run.status === 'pending_approval') return { title: displayCommand ? `等待授权：运行 ${displayCommand}` : '等待授权：运行命令' };
  if (run.status === 'running') return { title: displayCommand ? `正在运行 ${displayCommand}` : '正在运行命令' };
  if (run.status === 'error') return { title: displayCommand ? `命令运行失败 ${displayCommand}` : '命令运行失败' };
  if (run.status === 'rejected') return { title: displayCommand ? `已拒绝运行 ${displayCommand}` : '已拒绝运行命令' };
  return { title: displayCommand ? `已运行 ${displayCommand}` : '已运行命令' };
}

function runningAware(run: RuntimeToolRun, running: string, complete: string) {
  if (run.status === 'pending_approval') return `等待授权：${running}`;
  if (run.status === 'running') return `正在${running.replace(/^已?/, '')}`;
  if (run.status === 'error') return `${running.replace(/^已?/, '')}失败`;
  if (run.status === 'rejected') return `${running.replace(/^已?/, '')}已拒绝`;
  return complete;
}

function ToolRunStatus({ status }: { status: RuntimeToolRun['status'] }) {
  const text = statusTextFromStatus(status);
  return text ? <span className="chat-tool-run__status">{text}</span> : null;
}

function statusTextFromStatus(status: RuntimeToolRun['status']) {
  if (status === 'pending_approval') return '待确认';
  if (status === 'rejected') return '已拒绝';
  if (status === 'error') return '失败';
  return '';
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
  if (group.kind === 'fileMutation') return <Pencil size={14} />;
  return <CheckCircle2 size={14} />;
}

function toolRunIcon(run: RuntimeToolRun) {
  if (run.status === 'pending_approval') return <ShieldAlert size={14} />;
  if (run.status === 'running') return <Clock3 size={14} />;
  if (run.status === 'error') return <XCircle size={14} />;
  if (run.status === 'rejected') return <AlertCircle size={14} />;
  if (run.name.includes('search')) return <Search size={14} />;
  if (run.name.includes('shell')) return <TerminalSquare size={14} />;
  if (isFileOperationRun(run)) return <Pencil size={14} />;
  if (run.name.includes('file') || run.name.includes('workspace')) return <FileText size={14} />;
  if (run.name.includes('run')) return <Play size={14} />;
  if (run.status === 'success') return <CheckCircle2 size={14} />;
  return <Wrench size={14} />;
}

function recordFromJson(value: string | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function optionalNumber(value: unknown): number | null {
  const numberValue = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(numberValue) ? Math.max(0, numberValue) : null;
}

function countTextLines(value: string): number {
  if (!value) return 0;
  const lines = value.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines.length;
}

function toolDisplayName(name: string): string {
  return name.replace(/^mcp\s+\S+\s+/iu, '').replace(/_/g, ' ').trim() || '工具';
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

function isWebContentRun(run: RuntimeToolRun, url = stringField(recordFromJson(run.argumentsPreview).url)): boolean {
  if (!url) return false;
  return /(^|\s|_|-)fetch(web)?content($|\s|_|-)/iu.test(run.name) || /^https?:\/\//iu.test(url);
}

function compactUrlTarget(value: string): string {
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

function genericToolRunDiagnostic(run: RuntimeToolRun): string {
  if (run.status !== 'error' && run.status !== 'rejected') return '';
  return concisePreview(run.approvalMessage || run.resultPreview || run.approvalReason || '');
}

function concisePreview(value: string): string {
  const normalized = formatPreview(value).replace(/\s+/gu, ' ').trim();
  return normalized.length > 600 ? `${normalized.slice(0, 600)}...` : normalized;
}
