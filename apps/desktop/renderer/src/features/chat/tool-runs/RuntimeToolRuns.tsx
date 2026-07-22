import {
  type AnswerRuntimeApprovalInput,
  type RuntimeApprovalAvailableDecision,
  type RuntimeHookRun,
  type RuntimeStructuredInputValue,
  type RuntimeToolRun
} from '@setsuna-desktop/contracts';
import {
  ChevronDown,
  FileText,
  Undo2
} from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
  type SyntheticEvent,
} from 'react';
import { useI18n, type Translate } from '../../../shared/i18n/I18nProvider.js';
import { WorkspaceFileIcon } from '../../workspace/WorkspaceFileIcon.js';
import { WorkspaceFileLink } from '../markdown/WorkspaceFileLink.js';
import type {
  AnswerApprovalHandler,
  ToolRunDisplayGroup,
  ToolRunGroup,
  ToolRunGroupKind,
  ToolRunSummaryMode,
} from './runtime-tool-run-types.js';
import {
  type RuntimeFileChangeSummary
} from './runtimeFileChanges.js';
import { isActiveRuntimeToolRun } from './runtimeToolRunState.js';
import {
  compactStructuredInputValues,
  RuntimeStructuredInputField,
  structuredInputDefaults,
} from './RuntimeStructuredInputField.js';
import {
  activeToolRunOrLast,
  compactToolRunGroups,
  completedFileOperationActionLabel,
  fileOperationActionLabel,
  fileOperationChangeTotals,
  fileOperationEntries,
  fileOperationGroupSummary,
  fileOperationTarget,
  FileOperationTarget,
  fileOperationVerb,
  formatPreview,
  genericToolRunDiagnostic,
  groupToolRuns,
  inspectionEntries,
  inspectionEntryFromRun,
  inspectionEntryKind,
  inspectionEntryLabel,
  InspectionTarget,
  isConcreteFileOperationTarget,
  isFileOperationRun,
  isFlatInspectionRun,
  isPendingApprovalRun,
  isRecord,
  isShellRun,
  mixedToolRunGroupIcon,
  mixedToolRunGroupSummary,
  normalizeFileOperationAction,
  pathBaseName,
  pendingApprovalDisclosureKey,
  ShellTerminalResult,
  stringField,
  toolRunDisplayStableKey,
  toolRunGroupIcon,
  toolRunGroupId,
  toolRunGroupKind,
  toolRunGroupRuns,
  toolRunGroupStatus,
  toolRunGroupSummary,
  toolRunIcon,
  ToolRunStatus,
  toolRunSummary,
  ToolRunSummaryTarget
} from './RuntimeToolRunPresentation.js';
import { RuntimeUserInputActions } from './RuntimeUserInputActions.js';

export type { ToolRunGroup, ToolRunGroupKind, ToolRunSummaryMode } from './runtime-tool-run-types.js';
const fileChangePreviewLimit = 3;

export function shouldAutoOpenToolRunDisclosure(previousAutoOpenKey: string | undefined, autoOpenKey: string | undefined): boolean {
  return Boolean(autoOpenKey && autoOpenKey !== previousAutoOpenKey);
}

export function toolRunGroupKindClassName(kind: ToolRunGroupKind): string {
  const modifier = kind === 'fileMutation' ? 'file-mutation' : kind;
  return `chat-tool-run--${modifier}`;
}

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
  const group = compactToolRunGroups(groupToolRuns(visibleRuns), summaryMode)[0];
  if (!group) return null;
  return (
    <div className="chat-tool-runs">
      <ToolRunDisplayPanel group={group} onAnswerApproval={onAnswerApproval} />
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

function ToolRunDisclosure({
  autoOpenKey,
  children,
  className,
  summary,
}: {
  autoOpenKey?: string;
  children: ReactNode;
  className: string;
  summary: ReactNode;
}) {
  const [open, setOpen] = useState(() => Boolean(autoOpenKey));
  const previousAutoOpenKeyRef = useRef(autoOpenKey);

  useEffect(() => {
    if (shouldAutoOpenToolRunDisclosure(previousAutoOpenKeyRef.current, autoOpenKey)) {
      setOpen(true);
    }
    previousAutoOpenKeyRef.current = autoOpenKey;
  }, [autoOpenKey]);

  const handleSummaryClick = (event: MouseEvent<HTMLElement>) => {
    // 先记录用户选择，避免流式更新在原生 <details> 完成 toggle 前恢复旧状态。
    event.preventDefault();
    setOpen((value) => !value);
  };
  const handleToggle = (event: SyntheticEvent<HTMLDetailsElement>) => {
    const nextOpen = event.currentTarget.open;
    setOpen((value) => (value === nextOpen ? value : nextOpen));
  };

  return (
    <details className={className} open={open} onToggle={handleToggle}>
      <summary className="chat-tool-run__summary" onClick={handleSummaryClick}>
        {summary}
      </summary>
      {children}
    </details>
  );
}

function ToolRunDisplayPanel({
  group,
  onAnswerApproval,
}: {
  group: ToolRunDisplayGroup;
  onAnswerApproval: AnswerApprovalHandler;
}): JSX.Element {
  const { t } = useI18n();
  // 当流式运行项从单项变为分组或混合分组时，保持此组件及其根 DOM 节点稳定。
  // 展开状态只在本地保存；新的待授权请求会自动展开，普通流式更新不会覆盖用户选择。
  if (group.type === 'mixed') {
    return mixedToolRunGroupPanelNode(group, onAnswerApproval, t);
  }
  if (group.type === 'single' && isFileOperationRun(group.run) && !hasHookRuns(group.run)) {
    if (fileOperationEntries([group.run]).length > 1) {
      return toolRunGroupPanelNode(
        { type: 'group', id: `${group.run.id}:files`, kind: 'fileMutation', runs: [group.run] },
        onAnswerApproval,
        t,
      );
    }
    return <FileMutationRunRow run={group.run} onAnswerApproval={onAnswerApproval} />;
  }
  if (group.type === 'single' && isFlatInspectionRun(group.run) && !hasHookRuns(group.run)) return <FlatToolRunRow run={group.run} />;
  if (group.type === 'single') {
    return toolRunPanelNode(group.run, onAnswerApproval, t);
  }
  return toolRunGroupPanelNode(group, onAnswerApproval, t);
}

function toolRunPanelNode(run: RuntimeToolRun, onAnswerApproval: AnswerApprovalHandler, t: Translate): JSX.Element {
  const pendingApproval = isPendingApprovalRun(run);
  const pendingApprovalId = pendingApproval ? run.approvalId : undefined;
  const summary = toolRunSummary(run, t);
  const kind = toolRunGroupKind(run);
  const summaryInspectionKind = kind === 'inspection' ? inspectionEntryKind(run) : undefined;
  if (!toolRunHasDetails(run, pendingApprovalId)) return <FlatToolRunRow run={run} />;
  return (
    <ToolRunDisclosure
      autoOpenKey={pendingApprovalDisclosureKey([run])}
      className={`chat-tool-run chat-tool-run--panel ${toolRunGroupKindClassName(kind)} chat-tool-run--${run.status}`}
      summary={(
        <>
          <span className="chat-tool-run__icon">{toolRunIcon(run)}</span>
          <span className="chat-tool-run__summary-text">
            <span className="chat-tool-run__title">{summary.title}</span>
            <ToolRunSummaryTarget inspectionKind={summaryInspectionKind} kind={kind} target={summary.target} />
          </span>
          <ToolRunStatus status={run.status} summaryTitle={summary.title} />
        </>
      )}
    >
      <div className="chat-tool-run__body">
        <ToolRunDetails run={run} onAnswerApproval={onAnswerApproval} pendingApprovalId={pendingApprovalId} />
      </div>
    </ToolRunDisclosure>
  );
}

function toolRunGroupPanelNode(
  group: Extract<ToolRunGroup, { type: 'group' }>,
  onAnswerApproval: AnswerApprovalHandler,
  t: Translate,
): JSX.Element {
  const status = toolRunGroupStatus(group.runs);
  const summary = toolRunGroupSummary(group, t);
  const activeRuns = group.runs.filter(isActiveRuntimeToolRun);
  const visibleRuns = activeRuns.length ? activeRuns : group.runs;
  const focusedActiveRun = activeRuns.length === 1 ? activeRuns[0] : undefined;
  const showRunTitles = group.kind !== 'shell' && group.kind !== 'fileMutation';
  const shellGroup = group.kind === 'shell';
  const fileOperationGroup = group.kind === 'fileMutation';
  const fileOperationSummary = fileOperationGroup ? fileOperationGroupSummary(group.runs, t) : null;
  const summaryInspectionRun = group.kind === 'inspection' ? activeToolRunOrLast(group.runs) : undefined;
  const summaryInspectionKind = summaryInspectionRun ? inspectionEntryFromRun(summaryInspectionRun)?.kind : undefined;
  const fileOperationSummaryChangeCounts = fileOperationSummary?.target && isConcreteFileOperationTarget(fileOperationSummary.target)
    ? fileOperationSummary.changeCounts
    : undefined;
  return (
    <ToolRunDisclosure
      autoOpenKey={pendingApprovalDisclosureKey(group.runs)}
      className={`chat-tool-run chat-tool-run--group ${toolRunGroupKindClassName(group.kind)} chat-tool-run--${status}`}
      summary={(
        <>
          <span className="chat-tool-run__icon">{toolRunGroupIcon(group)}</span>
          <span className="chat-tool-run__summary-text">
            <span className="chat-tool-run__title">{summary.title}</span>
            <ToolRunSummaryTarget inspectionKind={summaryInspectionKind} kind={group.kind} target={summary.target} />
            {fileOperationSummaryChangeCounts ? (
              <ChangeCounts
                additions={fileOperationSummaryChangeCounts.additions}
                deletions={fileOperationSummaryChangeCounts.deletions}
                showZero={fileOperationSummaryChangeCounts.showZero}
              />
            ) : null}
          </span>
          <ToolRunStatus status={status} summaryTitle={summary.title} />
        </>
      )}
    >
      <div
        className={`chat-tool-run__body ${
          shellGroup
            ? 'chat-tool-run__body--shell-list'
            : fileOperationGroup
              ? 'chat-tool-run__body--file-operation'
              : 'chat-tool-run__body--group'
        }`}
      >
        {focusedActiveRun ? (
          // 外层分组已经显示当前活动项的摘要，直接展开详情可避免重复的运行/审批状态。
          <ToolRunDetails
            run={focusedActiveRun}
            onAnswerApproval={onAnswerApproval}
            pendingApprovalId={isPendingApprovalRun(focusedActiveRun) ? focusedActiveRun.approvalId : undefined}
          />
        ) : group.kind === 'inspection' ? (
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
          visibleRuns.map((run) => (
            <ToolRunDisplayPanel
              key={run.id}
              group={{ type: 'single', run }}
              onAnswerApproval={onAnswerApproval}
            />
          ))
        ) : (
          visibleRuns.map((run) => {
            const pendingApproval = isPendingApprovalRun(run);
            const pendingApprovalId = pendingApproval ? run.approvalId : undefined;
            const runSummary = toolRunSummary(run, t);
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
    </ToolRunDisclosure>
  );
}

function mixedToolRunGroupPanelNode(
  group: Extract<ToolRunDisplayGroup, { type: 'mixed' }>,
  onAnswerApproval: AnswerApprovalHandler,
  t: Translate,
): JSX.Element {
  const runs = group.groups.flatMap(toolRunGroupRuns);
  const status = toolRunGroupStatus(runs);
  const activeRuns = runs.filter(isActiveRuntimeToolRun);
  const focusedActiveRun = activeRuns.length === 1 ? activeRuns[0] : undefined;
  const visibleGroups = activeRuns.length ? group.groups.map(onlyActiveToolGroup).filter(isToolRunGroup) : group.groups;
  const compactSummary = mixedToolRunGroupSummary(group.groups, group.summaryMode, t);
  const compactSummaryChangeCounts = compactSummary.target && isConcreteFileOperationTarget(compactSummary.target)
    ? compactSummary.changeCounts
    : undefined;
  return (
    <ToolRunDisclosure
      autoOpenKey={pendingApprovalDisclosureKey(runs)}
      className={`chat-tool-run chat-tool-run--group chat-tool-run--mixed chat-tool-run--${status}`}
      summary={(
        <>
          <span className="chat-tool-run__icon">{mixedToolRunGroupIcon(status)}</span>
          <span className="chat-tool-run__summary-text">
            <span className="chat-tool-run__title">{compactSummary.title}</span>
            <ToolRunSummaryTarget
              inspectionKind={compactSummary.inspectionKind}
              kind={compactSummary.targetKind}
              target={compactSummary.target}
            />
            {compactSummaryChangeCounts ? (
              <ChangeCounts
                additions={compactSummaryChangeCounts.additions}
                deletions={compactSummaryChangeCounts.deletions}
                showZero={compactSummaryChangeCounts.showZero}
              />
            ) : null}
          </span>
          <ToolRunStatus status={status} summaryTitle={compactSummary.title} />
        </>
      )}
    >
      <div className="chat-tool-run__body chat-tool-run__body--mixed-list">
        {focusedActiveRun ? (
          // 活动期间只聚焦当前工具；仅有一项时无需再渲染一层相同的进度摘要。
          <ToolRunDetails
            run={focusedActiveRun}
            onAnswerApproval={onAnswerApproval}
            pendingApprovalId={isPendingApprovalRun(focusedActiveRun) ? focusedActiveRun.approvalId : undefined}
          />
        ) : (
          visibleGroups.map((childGroup) => renderMixedToolRunChildGroup(childGroup, onAnswerApproval))
        )}
      </div>
    </ToolRunDisclosure>
  );
}

function renderMixedToolRunChildGroup(
  group: ToolRunGroup,
  onAnswerApproval: AnswerApprovalHandler,
): JSX.Element | null {
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
  return (
    <ToolRunDisplayPanel
      key={toolRunDisplayStableKey(group)}
      group={group}
      onAnswerApproval={onAnswerApproval}
    />
  );
}

function onlyActiveToolGroup(group: ToolRunGroup): ToolRunGroup | null {
  const runs = toolRunGroupRuns(group).filter(isActiveRuntimeToolRun);
  if (!runs.length) return null;
  return runs.length === 1
    ? { type: 'single', run: runs[0] }
    : {
        type: 'group',
        id: `${toolRunGroupId(group)}:active`,
        kind: group.type === 'single' ? toolRunGroupKind(group.run) : group.kind,
        runs,
      };
}

function isToolRunGroup(group: ToolRunGroup | null): group is ToolRunGroup {
  return group !== null;
}

function FlatToolRunRow({ run }: { run: RuntimeToolRun }) {
  const { t } = useI18n();
  const summary = toolRunSummary(run, t);
  const kind = toolRunGroupKind(run);
  return (
    <div className={`chat-tool-run chat-tool-run--flat ${toolRunGroupKindClassName(kind)} chat-tool-run--${run.status}`}>
      <div className="chat-tool-run__summary">
        <span className="chat-tool-run__icon">{toolRunIcon(run)}</span>
        <span className="chat-tool-run__summary-text">
          <span className="chat-tool-run__title">{summary.title}</span>
          <ToolRunSummaryTarget
            inspectionKind={kind === 'inspection' ? inspectionEntryKind(run) : undefined}
            kind={kind}
            target={summary.target}
          />
        </span>
        <ToolRunStatus status={run.status} summaryTitle={summary.title} />
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
  const { t } = useI18n();
  const pendingApprovalId = isPendingApprovalRun(run) ? run.approvalId : undefined;
  const target = fileOperationTarget(run, t);
  const error = run.status === 'error' ? formatPreview(run.resultPreview ?? '') : '';
  const totals = fileOperationChangeTotals(run);
  return (
    <div className={`chat-tool-run chat-tool-run--flat ${toolRunGroupKindClassName('fileMutation')} chat-tool-run--${run.status}`}>
      <div className="chat-tool-run__summary">
        <span className="chat-tool-run__icon">{toolRunIcon(run)}</span>
        <span className="chat-tool-run__summary-text">
          <span className="chat-tool-run__file-status">
            <span>{fileOperationVerb(run, t)}</span>
            {target ? (
              <>
                <FileOperationTarget target={target} />
                <ChangeCounts additions={totals?.additions} deletions={totals?.deletions} showZero={run.status === 'running'} />
              </>
            ) : null}
          </span>
        </span>
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
  onOpenReview?: (filePath?: string) => void;
}) {
  const { t } = useI18n();
  const [discarding, setDiscarding] = useState(false);
  const [discarded, setDiscarded] = useState(false);
  const [discardError, setDiscardError] = useState<string | null>(null);
  const fileCount = summary.files.length;
  const singleFile = fileCount === 1 ? summary.files[0] : undefined;
  const filePaths = useMemo(() => [...new Set(summary.files.map((file) => file.path).filter(Boolean))], [summary.files]);
  const filePathKey = useMemo(() => filePaths.join('\0'), [filePaths]);
  const [showAllFiles, setShowAllFiles] = useState(false);
  const canDiscard = Boolean(onDiscardChanges && filePaths.length && !discarded);
  const hasMoreFiles = fileCount > fileChangePreviewLimit;
  const visibleFiles = showAllFiles || !hasMoreFiles ? summary.files : summary.files.slice(0, fileChangePreviewLimit);
  const hiddenFileCount = Math.max(0, fileCount - fileChangePreviewLimit);
  useEffect(() => {
    setShowAllFiles(false);
  }, [filePathKey]);
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
    <section className="chat-file-changes" aria-label={t('toolRun.changes.label')}>
      <div className="chat-file-changes__header">
        <span className="chat-file-changes__icon" aria-hidden="true">
          <FileText size={14} />
        </span>
        <span className="chat-file-changes__summary">
          <span className="chat-file-changes__title">
            {singleFile
              ? `${completedFileOperationActionLabel(normalizeFileOperationAction(singleFile.action), t)} ${pathBaseName(singleFile.path, t)}`
              : t('toolRun.changes.filesEdited', { count: fileCount })}
          </span>
          {singleFile ? <ChangeCounts additions={singleFile.additions} deletions={singleFile.deletions} showZero /> : null}
        </span>
        {onOpenReview || onDiscardChanges ? (
          <span className="chat-file-changes__actions">
            {onDiscardChanges ? (
              <button
                className="chat-file-changes__action chat-file-changes__action--danger"
                type="button"
                disabled={!canDiscard || discarding}
                onClick={() => void discardChanges()}
              >
                <Undo2 size={13} />
                <span>{t(discarding
                  ? 'toolRun.changes.undoing'
                  : discarded
                    ? 'toolRun.changes.undone'
                    : 'toolRun.changes.undo')}</span>
              </button>
            ) : null}
            {onOpenReview ? (
              <button className="chat-file-changes__action chat-file-changes__action--review" type="button" onClick={() => onOpenReview()}>
                <span>{t('toolRun.changes.review')}</span>
              </button>
            ) : null}
          </span>
        ) : null}
      </div>
      {discardError ? <div className="chat-file-changes__error">{discardError}</div> : null}
      <div className="chat-file-changes__list">
        {visibleFiles.map((file) => (
          <div className="chat-file-changes__item" key={file.path}>
            <button
              className="chat-file-changes__row"
              type="button"
              disabled={!onOpenReview}
              title={file.path}
              onClick={() => onOpenReview?.(file.path)}
            >
              <WorkspaceFileIcon className="chat-file-changes__file-icon" path={file.path} type="file" />
              <span className="chat-file-changes__path" title={file.path}>
                {file.path}
              </span>
              <ChangeCounts additions={file.additions} deletions={file.deletions} showZero />
            </button>
          </div>
        ))}
        {hasMoreFiles ? (
          <button
            className="chat-file-changes__more"
            type="button"
            aria-expanded={showAllFiles}
            onClick={() => setShowAllFiles((current) => !current)}
          >
            <span>{showAllFiles
              ? t('toolRun.changes.collapse')
              : t('toolRun.changes.showMore', { count: hiddenFileCount })}</span>
            <ChevronDown className="chat-file-changes__more-chevron" size={13} />
          </button>
        ) : null}
      </div>
    </section>
  );
}

function ChangeCounts({ additions, deletions, showZero = false }: { additions?: number; deletions?: number; showZero?: boolean }) {
  const { t } = useI18n();
  const add = Number.isFinite(additions) ? Math.max(0, Number(additions)) : null;
  const del = Number.isFinite(deletions) ? Math.max(0, Number(deletions)) : null;
  if (!showZero && (add || 0) === 0 && (del || 0) === 0) return null;
  return (
    <span className="chat-change-counts" aria-label={t('toolRun.changes.lineCounts', { additions: add || 0, deletions: del || 0 })}>
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

function InspectionTargetList({ runs }: { runs: RuntimeToolRun[] }) {
  const { t } = useI18n();
  const entries = inspectionEntries(runs);
  if (!entries.length) return null;
  return (
    <ul className="chat-tool-run__inspection-list">
      {entries.map((entry) => (
        <li className="chat-tool-run__inspection-item" key={`${entry.kind}:${entry.target}`}>
          <span>{inspectionEntryLabel(entry.kind, t)}</span>
          <InspectionTarget className="chat-tool-run__file-list-target" entry={entry} />
        </li>
      ))}
    </ul>
  );
}

function FileOperationTargetList({ runs }: { runs: RuntimeToolRun[] }) {
  const { t } = useI18n();
  const entries = fileOperationEntries(runs, { appliedOnlyWhenCompletedMutation: true });
  if (!entries.length) return null;
  return (
    <ul className="chat-tool-run__inspection-list chat-tool-run__file-operation-list">
      {entries.map((entry) => (
        <li className="chat-tool-run__inspection-item" key={`${entry.action}:${entry.path}`}>
          <span>{fileOperationActionLabel(entry.action, t)}</span>
          <WorkspaceFileLink className="chat-tool-run__file-list-target" filePath={entry.path} linkKind="workspace-tool">
            {pathBaseName(entry.path, t)}
          </WorkspaceFileLink>
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
  const { t } = useI18n();
  const execPolicySummary = execPolicyApprovalSummary(run);
  const permissionSummary = permissionApprovalSummary(run);
  const networkSummary = networkApprovalSummary(run);
  const hookRuns = <HookRunList runs={run.hookRuns} />;
  const approvalActions = pendingApprovalId
    ? run.userInput
      ? <RuntimeUserInputActions approvalId={pendingApprovalId} run={run} onAnswerApproval={onAnswerApproval} />
      : run.elicitation
        ? <McpElicitationActions approvalId={pendingApprovalId} run={run} onAnswerApproval={onAnswerApproval} />
        : <ApprovalActions approvalId={pendingApprovalId} availableDecisions={run.availableApprovalDecisions} onAnswerApproval={onAnswerApproval} />
    : null;
  if (isShellRun(run)) {
    return (
      <>
        <ShellTerminalResult run={run} />
        {execPolicySummary ? <ToolPreview label={t('toolRun.preview.execPolicy')} value={execPolicySummary} /> : null}
        {networkSummary ? <ToolPreview label={t('toolRun.preview.network')} value={networkSummary} /> : null}
        {permissionSummary ? <ToolPreview label={t('toolRun.preview.permission')} value={permissionSummary} /> : null}
        {hookRuns}
        {approvalActions}
      </>
    );
  }
  if (toolRunGroupKind(run) === 'inspection') {
    return (
      <>
        <InspectionTargetList runs={[run]} />
        {execPolicySummary ? <ToolPreview label={t('toolRun.preview.execPolicy')} value={execPolicySummary} /> : null}
        {networkSummary ? <ToolPreview label={t('toolRun.preview.network')} value={networkSummary} /> : null}
        {permissionSummary ? <ToolPreview label={t('toolRun.preview.permission')} value={permissionSummary} /> : null}
        {hookRuns}
        {approvalActions}
      </>
    );
  }
  if (isFileOperationRun(run)) {
    return (
      <>
        {run.status === 'error' && run.resultPreview ? <div className="chat-tool-run__file-error">{formatPreview(run.resultPreview)}</div> : null}
        {execPolicySummary ? <ToolPreview label={t('toolRun.preview.execPolicy')} value={execPolicySummary} /> : null}
        {networkSummary ? <ToolPreview label={t('toolRun.preview.network')} value={networkSummary} /> : null}
        {permissionSummary ? <ToolPreview label={t('toolRun.preview.permission')} value={permissionSummary} /> : null}
        {hookRuns}
        {approvalActions}
      </>
    );
  }
  const diagnostic = genericToolRunDiagnostic(run);
  return (
    <>
      {execPolicySummary ? <ToolPreview label={t('toolRun.preview.execPolicy')} value={execPolicySummary} /> : null}
      {networkSummary ? <ToolPreview label={t('toolRun.preview.network')} value={networkSummary} /> : null}
      {permissionSummary ? <ToolPreview label={t('toolRun.preview.permission')} value={permissionSummary} /> : null}
      {diagnostic ? <ToolPreview label={t(run.status === 'cancelled'
        ? 'toolRun.preview.cancelled'
        : run.status === 'rejected'
          ? 'toolRun.preview.rejected'
          : 'toolRun.preview.error')} value={diagnostic} /> : null}
      {hookRuns}
      {approvalActions}
    </>
  );
}

function GroupedHookRunList({ runs }: { runs: RuntimeToolRun[] }) {
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
                inspectionKind={kind === 'inspection' ? inspectionEntryKind(run) : undefined}
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

function HookRunList({ runs }: { runs?: RuntimeHookRun[] }) {
  const { t } = useI18n();
  if (!runs?.length) return null;
  return (
    <div className="chat-tool-run__hooks">
      {runs.map((run) => (
        <div className={`chat-tool-run__hook chat-tool-run__hook--${run.status}`} key={run.id}>
          <span className="chat-tool-run__hook-dot" />
          <span className="chat-tool-run__hook-main">
            <span className="chat-tool-run__hook-title">{hookRunTitle(run, t)}</span>
            {run.message ? <span className="chat-tool-run__hook-message">{run.message}</span> : null}
            <HookOutputEntryList entries={run.entries} />
          </span>
          {hookRunStatusText(run.status, t) ? <span className="chat-tool-run__hook-status">{hookRunStatusText(run.status, t)}</span> : null}
        </div>
      ))}
    </div>
  );
}

function HookOutputEntryList({ entries }: { entries?: RuntimeHookRun['entries'] }) {
  const { t } = useI18n();
  if (!entries?.length) return null;
  return (
    <span className="chat-tool-run__hook-entries">
      {entries.map((entry, index) => (
        <span className={`chat-tool-run__hook-entry chat-tool-run__hook-entry--${entry.kind}`} key={`${entry.kind}:${index}`}>
          {hookOutputEntryLabel(entry.kind, t)} {entry.text}
        </span>
      ))}
    </span>
  );
}

function hookOutputEntryLabel(kind: NonNullable<RuntimeHookRun['entries']>[number]['kind'], t: Translate): string {
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

function hookEventLabel(eventName: RuntimeHookRun['eventName'], t: Translate): string {
  if (eventName === 'PreToolUse') return t('toolRun.hook.event.preToolUse');
  if (eventName === 'PermissionRequest') return t('toolRun.hook.event.permissionRequest');
  if (eventName === 'PostToolUse') return t('toolRun.hook.event.postToolUse');
  if (eventName === 'PreCompact') return t('toolRun.hook.event.preCompact');
  if (eventName === 'PostCompact') return t('toolRun.hook.event.postCompact');
  if (eventName === 'SessionStart') return t('toolRun.hook.event.sessionStart');
  if (eventName === 'SubagentStart') return t('toolRun.hook.event.subagentStart');
  if (eventName === 'UserPromptSubmit') return t('toolRun.hook.event.userPromptSubmit');
  if (eventName === 'SubagentStop') return t('toolRun.hook.event.subagentStop');
  if (eventName === 'Stop') return t('toolRun.hook.event.stop');
  return 'hook';
}

function hookRunStatusText(status: RuntimeHookRun['status'], t: Translate): string {
  if (status === 'running') return t('toolRun.hook.status.running');
  if (status === 'blocked') return t('toolRun.hook.status.blocked');
  if (status === 'stopped') return t('toolRun.hook.status.stopped');
  if (status === 'failed') return t('toolRun.hook.status.failed');
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
  const { t } = useI18n();
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
            {submittingDecisionKey === approvalDecisionKey(decision)
              ? t('toolRun.approval.submitting', { decision: approvalDecisionLabel(decision, t) })
              : approvalDecisionLabel(decision, t)}
          </button>
        ))}
      </div>
      {error ? <div className="chat-tool-run__action-error">{error}</div> : null}
    </div>
  );
}

function McpElicitationActions({
  approvalId,
  run,
  onAnswerApproval,
}: {
  approvalId: string;
  run: RuntimeToolRun;
  onAnswerApproval: AnswerApprovalHandler;
}) {
  const { t } = useI18n();
  const elicitation = run.elicitation;
  const [values, setValues] = useState<Record<string, RuntimeStructuredInputValue>>(() =>
    elicitation?.mode === 'form' ? structuredInputDefaults(elicitation.requestedSchema.properties) : {},
  );
  const [submittingAction, setSubmittingAction] = useState<'accept' | 'decline' | 'cancel' | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!elicitation) return null;

  const submit = async (action: 'accept' | 'decline' | 'cancel') => {
    if (submittingAction) return;
    setSubmittingAction(action);
    setError(null);
    try {
      const decision = action === 'accept' ? 'approve' : action === 'decline' ? 'reject' : 'cancel';
      await onAnswerApproval(approvalId, {
        decision,
        elicitationResponse: {
          action,
          ...(action === 'accept' && elicitation.mode === 'form'
            ? { content: compactStructuredInputValues(values) }
            : {}),
        },
      });
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      setSubmittingAction(null);
    }
  };

  return (
    <form
      className="chat-tool-run__elicitation"
      onSubmit={(event) => {
        event.preventDefault();
        void submit('accept');
      }}
    >
      <div className="chat-tool-run__elicitation-header">
        <strong>{t(elicitation.mode === 'form' ? 'toolRun.elicitation.formTitle' : 'toolRun.elicitation.urlTitle')}</strong>
        <span>{elicitation.serverKey}</span>
      </div>
      <p className="chat-tool-run__elicitation-message">{elicitation.message}</p>
      {elicitation.mode === 'form' ? (
        <div className="chat-tool-run__elicitation-fields">
          {Object.entries(elicitation.requestedSchema.properties).map(([name, field]) => (
            <RuntimeStructuredInputField
              field={field}
              key={name}
              name={name}
              required={elicitation.requestedSchema.required?.includes(name) === true}
              value={values[name]}
              onChange={(value) => setValues((current) => ({ ...current, [name]: value }))}
            />
          ))}
        </div>
      ) : (
        <code className="chat-tool-run__elicitation-url">{elicitation.displayUrl}</code>
      )}
      <div className="chat-tool-run__actions">
        <button type="submit" disabled={Boolean(submittingAction)}>
          {t(submittingAction === 'accept'
            ? 'toolRun.elicitation.submitting'
            : elicitation.mode === 'form'
              ? 'toolRun.elicitation.submit'
              : 'toolRun.elicitation.opening')}
        </button>
        <button type="button" disabled={Boolean(submittingAction)} onClick={() => void submit('decline')}>
          {t(submittingAction === 'decline' ? 'toolRun.elicitation.declining' : 'toolRun.elicitation.decline')}
        </button>
        <button type="button" disabled={Boolean(submittingAction)} onClick={() => void submit('cancel')}>
          {t(submittingAction === 'cancel' ? 'toolRun.elicitation.cancelling' : 'toolRun.elicitation.cancelTurn')}
        </button>
      </div>
      {error ? <div className="chat-tool-run__action-error">{error}</div> : null}
    </form>
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

function approvalDecisionLabel(decision: RuntimeApprovalAvailableDecision, t: Translate): string {
  if (decision.type === 'approve') return t('toolRun.approval.approve');
  if (decision.type === 'approve_for_turn_with_strict_auto_review') return t('toolRun.approval.strictReview');
  if (decision.type === 'approve_for_session') return t('toolRun.approval.session');
  if (decision.type === 'approve_persistently') return t('toolRun.approval.persistent');
  if (decision.type === 'approve_exec_policy_amendment') return t('toolRun.approval.execPolicy');
  if (decision.type === 'approve_network_policy_amendment') return t(decision.networkPolicyAmendment.action === 'deny'
    ? 'toolRun.approval.networkDeny'
    : 'toolRun.approval.networkAllow');
  if (decision.type === 'cancel') return t('toolRun.approval.cancelTurn');
  return t('toolRun.approval.reject');
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

export { groupToolRuns, toolRunDisplayStableKey } from './RuntimeToolRunPresentation.js';
