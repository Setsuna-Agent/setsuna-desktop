import type {
  RuntimeHookRun,
  RuntimeToolRun,
} from '@setsuna-desktop/contracts';
import type { ResolvedToolResultView } from '@setsuna-desktop/feature-core/renderer';
import { ChevronDown } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from 'react';
import { useI18n, type Translate } from '../../../shared/i18n/I18nProvider.js';
import { FeatureContributionBoundary } from '../../../composition/FeatureContributionBoundary.js';
import { useRendererFeatureViews } from '../../../composition/feature-view-registries.js';
import { useChatThreadId } from '../conversation/ChatThreadProvider.js';
import { WorkspaceFileLink } from '../markdown/WorkspaceFileLink.js';
import type {
  AnswerApprovalHandler,
  ToolRunDisplayGroup,
  ToolRunGroup,
  ToolRunGroupKind,
  ToolRunSummaryMode,
} from './runtime-tool-run-types.js';
import { isDisplayableRuntimeToolRun } from './runtimeToolRunVisibility.js';
import { isActiveRuntimeToolRun } from './runtimeToolRunState.js';
import {
  ChangeCounts,
} from './RuntimeFileChangesSummaryCard.js';
import {
  RuntimeFileDiffDisclosure,
  RuntimeFileDiffPreview,
} from './RuntimeFileDiffPreview.js';
import {
  fileChangeFromToolRun,
  fileChangesFromToolRun,
  type RuntimeFileChange,
} from './runtimeFileChanges.js';
import {
  GroupedHookRunList,
  hasHookRuns,
  HookRunList,
} from './RuntimeHookRunDetails.js';
import {
  McpElicitationActions,
  RuntimeToolApprovalControl,
} from './RuntimeToolApprovalActions.js';
import {
  activeToolRunOrLast,
  compactToolRunGroups,
  fileOperationActionLabel,
  fileOperationChangeTotals,
  fileOperationEntries,
  fileOperationStableChangeEntries,
  fileOperationGroupSummary,
  fileOperationTarget,
  FileOperationTarget,
  fileOperationVerb,
  formatPreview,
  genericToolRunDiagnostic,
  groupToolRuns,
  inspectionEntries,
  inspectionEntryFromRun,
  inspectionEntryIcon,
  inspectionEntryKind,
  inspectionEntryLabel,
  InspectionTarget,
  isConcreteFileOperationTarget,
  isFileOperationRun,
  isFlatInspectionRun,
  isPendingApprovalRun,
  isPreparingToolRun,
  isShellRun,
  mixedToolRunGroupIcon,
  mixedToolRunGroupSummary,
  normalizeFileOperationPath,
  pathBaseName,
  pendingApprovalDisclosureKey,
  ShellTerminalResult,
  toolRunDisplayStableKey,
  toolRunGroupIcon,
  toolRunGroupId,
  toolRunGroupKind,
  toolRunGroupRuns,
  toolRunGroupStatus,
  toolRunGroupSummary,
  toolRunIcon,
  toolRunKindIcon,
  ToolRunStatus,
  toolRunSummary,
  ToolRunSummaryTarget
} from './RuntimeToolRunPresentation.js';
import { RuntimeUserInputActions } from './RuntimeUserInputActions.js';
import {
  execPolicyApprovalSummary,
  networkApprovalSummary,
  permissionApprovalSummary,
} from './runtimeApprovalSummaries.js';

export type { ToolRunGroup, ToolRunGroupKind, ToolRunSummaryMode } from './runtime-tool-run-types.js';

export function shouldAutoOpenToolRunDisclosure(previousAutoOpenKey: string | undefined, autoOpenKey: string | undefined): boolean {
  return Boolean(autoOpenKey && autoOpenKey !== previousAutoOpenKey);
}

function toolRunGroupKindClassName(kind: ToolRunGroupKind): string {
  const modifier = kind === 'fileMutation' ? 'file-mutation' : kind;
  return `chat-tool-run--${modifier}`;
}

export function RuntimeToolRuns({
  children,
  runs,
  onAnswerApproval,
  summaryMode = 'aggregate',
}: {
  children?: ReactNode;
  runs: RuntimeToolRun[];
  onAnswerApproval: AnswerApprovalHandler;
  summaryMode?: ToolRunSummaryMode;
}) {
  const featureViews = useRendererFeatureViews();
  const visibleRuns = runs.filter(isDisplayableRuntimeToolRun);
  if (!visibleRuns.length) return null;
  const singleRun = visibleRuns.length === 1 ? visibleRuns[0] : undefined;
  const replacement = singleRun ? featureViews.toolResults.resolve(singleRun.data) : null;
  if (singleRun && replacement?.contribution.presentation === 'replace') {
    return <FeatureToolResultView result={replacement} runId={singleRun.id} />;
  }
  const group = compactToolRunGroups(groupToolRuns(visibleRuns), summaryMode)[0];
  if (!group) return null;
  return (
    <div className="chat-tool-runs">
      <ToolRunDisplayPanel group={group} nestedDetails={children} onAnswerApproval={onAnswerApproval} />
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

function ToolRunDisclosure({
  autoOpenKey,
  children,
  className,
  lazy = false,
  summary,
}: {
  autoOpenKey?: string;
  children: ReactNode;
  className: string;
  lazy?: boolean;
  summary: ReactNode;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const initiallyOpen = useRef(Boolean(autoOpenKey)).current;
  const previousAutoOpenKeyRef = useRef(autoOpenKey);
  const [expanded, setExpanded] = useState(initiallyOpen);

  useEffect(() => {
    if (shouldAutoOpenToolRunDisclosure(previousAutoOpenKeyRef.current, autoOpenKey)) {
      const details = detailsRef.current;
      if (details) details.open = true;
      setExpanded(true);
    }
    previousAutoOpenKeyRef.current = autoOpenKey;
  }, [autoOpenKey]);

  const handleToggle = (event: SyntheticEvent<HTMLDetailsElement>) => {
    setExpanded(event.currentTarget.open);
  };

  // open 只提供稳定的初始值；挂载后由原生 details 保存用户选择，流式更新不会反向改写。
  return (
    <details ref={detailsRef} className={className} open={initiallyOpen} onToggle={handleToggle}>
      <summary className="chat-tool-run__summary">
        {summary}
        <ChevronDown aria-hidden="true" className="chat-tool-run__chevron" size={12} />
      </summary>
      {!lazy || expanded ? children : null}
    </details>
  );
}

function ToolRunDisplayPanel({
  group,
  nestedDetails,
  onAnswerApproval,
}: {
  group: ToolRunDisplayGroup;
  nestedDetails?: ReactNode;
  onAnswerApproval: AnswerApprovalHandler;
}): JSX.Element {
  const { t } = useI18n();
  const featureViews = useRendererFeatureViews();
  // 当流式运行项从单项变为分组或混合分组时，保持此组件及其根 DOM 节点稳定。
  // 展开状态只在本地保存；新的待授权请求会自动展开，普通流式更新不会覆盖用户选择。
  if (group.type === 'mixed') {
    return mixedToolRunGroupPanelNode(group, onAnswerApproval, t, nestedDetails);
  }
  if (group.type === 'single') {
    const featureResult = featureViews.toolResults.resolve(group.run.data);
    if (featureResult) {
      const content = <FeatureToolResultView result={featureResult} runId={group.run.id} />;
      if (featureResult.contribution.presentation === 'replace') return content;
      return (
        <FlatToolRunRow
          run={group.run}
          nestedDetails={content}
        />
      );
    }
  }
  if (group.type === 'single' && isFileOperationRun(group.run) && !hasHookRuns(group.run)) {
    if (fileOperationEntries([group.run]).length > 1) {
      return toolRunGroupPanelNode(
        { type: 'group', id: `${group.run.id}:files`, kind: 'fileMutation', runs: [group.run] },
        onAnswerApproval,
        t,
        nestedDetails,
      );
    }
    return <FileMutationRunRow run={group.run} nestedDetails={nestedDetails} onAnswerApproval={onAnswerApproval} />;
  }
  if (group.type === 'single' && isFlatInspectionRun(group.run) && !hasHookRuns(group.run)) {
    return <FlatToolRunRow run={group.run} nestedDetails={nestedDetails} />;
  }
  if (group.type === 'single') {
    return toolRunPanelNode(group.run, onAnswerApproval, t, nestedDetails);
  }
  return toolRunGroupPanelNode(group, onAnswerApproval, t, nestedDetails);
}

function FeatureToolResultView({
  result,
  runId,
}: Readonly<{
  result: ResolvedToolResultView;
  runId: string;
}>) {
  const { t } = useI18n();
  const threadId = useChatThreadId();
  const ResultView = result.contribution.render;
  return (
    <FeatureContributionBoundary
      fallback={(reset) => (
        <div className="chat-tool-run__preview" role="alert">
          <p>{t('featureRecovery.toolResultFailed')}</p>
          <button type="button" onClick={reset}>{t('common.retry')}</button>
        </div>
      )}
      featureId={result.featureId}
      resetKey={`${runId}:${result.contribution.resultKind}:${result.contribution.major}`}
    >
      <ResultView payload={result.payload} threadId={threadId} translate={t} />
    </FeatureContributionBoundary>
  );
}

function toolRunPanelNode(
  run: RuntimeToolRun,
  onAnswerApproval: AnswerApprovalHandler,
  t: Translate,
  nestedDetails?: ReactNode,
): JSX.Element {
  const pendingApproval = isPendingApprovalRun(run);
  const pendingApprovalId = pendingApproval ? run.approvalId : undefined;
  const summary = toolRunSummary(run, t);
  const kind = toolRunGroupKind(run);
  const fileChanges = kind === 'fileMutation' ? fileChangesFromToolRun(run) : [];
  const summaryInspectionKind = kind === 'inspection' ? inspectionEntryKind(run) : undefined;
  if (!toolRunHasDetails(run, pendingApprovalId, t)) return <FlatToolRunRow run={run} nestedDetails={nestedDetails} />;
  return (
    <ToolRunDisclosure
      autoOpenKey={pendingApprovalDisclosureKey([run])}
      className={`chat-tool-run chat-tool-run--panel ${toolRunGroupKindClassName(kind)} chat-tool-run--${run.status}`}
      lazy={fileChanges.some((change) => change.lines.length > 0)}
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
        {nestedDetails}
      </div>
    </ToolRunDisclosure>
  );
}

function toolRunGroupPanelNode(
  group: Extract<ToolRunGroup, { type: 'group' }>,
  onAnswerApproval: AnswerApprovalHandler,
  t: Translate,
  nestedDetails?: ReactNode,
): JSX.Element {
  const status = toolRunGroupStatus(group.runs);
  const summary = toolRunGroupSummary(group, t);
  const activeRuns = group.runs.filter(isActiveRuntimeToolRun);
  const visibleRuns = activeRuns.length ? activeRuns : group.runs;
  const focusedActiveRun = activeRuns.length === 1 ? activeRuns[0] : undefined;
  const showRunTitles = group.kind !== 'shell' && group.kind !== 'fileMutation';
  const shellGroup = group.kind === 'shell';
  const fileOperationGroup = group.kind === 'fileMutation';
  const stableFileRuns = fileOperationGroup && focusedActiveRun && isPreparingToolRun(focusedActiveRun)
    ? group.runs.filter((run) => !isPreparingToolRun(run))
    : [];
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
          <span className="chat-tool-run__icon">{toolRunGroupIcon(group.kind, status)}</span>
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
          <>
            {stableFileRuns.length ? <FileOperationTargetList runs={stableFileRuns} /> : null}
            {/* 外层分组已经显示当前活动项的摘要，直接展开详情可避免重复的运行/审批状态。 */}
            <ToolRunDetails
              run={focusedActiveRun}
              onAnswerApproval={onAnswerApproval}
              pendingApprovalId={isPendingApprovalRun(focusedActiveRun) ? focusedActiveRun.approvalId : undefined}
            />
          </>
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
                    <span aria-hidden="true" className="chat-tool-run__icon chat-tool-run__detail-icon">
                      {toolRunIcon(run)}
                    </span>
                    <span>{runSummary.title}</span>
                    {runSummary.target ? <code>{runSummary.target}</code> : null}
                  </div>
                ) : null}
                <ToolRunDetails run={run} onAnswerApproval={onAnswerApproval} pendingApprovalId={pendingApprovalId} />
              </div>
            );
          })
        )}
        {nestedDetails}
      </div>
    </ToolRunDisclosure>
  );
}

function mixedToolRunGroupPanelNode(
  group: Extract<ToolRunDisplayGroup, { type: 'mixed' }>,
  onAnswerApproval: AnswerApprovalHandler,
  t: Translate,
  nestedDetails?: ReactNode,
): JSX.Element {
  const runs = group.groups.flatMap(toolRunGroupRuns);
  const status = toolRunGroupStatus(runs);
  const activeRuns = runs.filter(isActiveRuntimeToolRun);
  const focusedActiveRun = activeRuns.length === 1 ? activeRuns[0] : undefined;
  const focusedGroup = focusedActiveRun
    ? group.groups.find((childGroup) => toolRunGroupRuns(childGroup).some((run) => run.id === focusedActiveRun.id))
    : undefined;
  const stableFileRuns = focusedActiveRun
    && focusedGroup
    && isPreparingToolRun(focusedActiveRun)
    && toolRunGroupKind(focusedActiveRun) === 'fileMutation'
    ? toolRunGroupRuns(focusedGroup).filter((run) => !isPreparingToolRun(run))
    : [];
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
          <>
            {stableFileRuns.length ? <FileOperationTargetList runs={stableFileRuns} /> : null}
            {/* 活动期间只聚焦当前工具；仅有一项时无需再渲染一层相同的进度摘要。 */}
            <ToolRunDetails
              run={focusedActiveRun}
              onAnswerApproval={onAnswerApproval}
              pendingApprovalId={isPendingApprovalRun(focusedActiveRun) ? focusedActiveRun.approvalId : undefined}
            />
          </>
        ) : (
          visibleGroups.map((childGroup) => renderMixedToolRunChildGroup(childGroup, onAnswerApproval))
        )}
        {nestedDetails}
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

function FlatToolRunRow({
  run,
  nestedDetails,
}: {
  run: RuntimeToolRun;
  nestedDetails?: ReactNode;
}) {
  const { t } = useI18n();
  const summary = toolRunSummary(run, t);
  const kind = toolRunGroupKind(run);
  const summaryNode = (
    <>
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
    </>
  );
  if (nestedDetails) {
    return (
      <ToolRunDisclosure
        className={`chat-tool-run chat-tool-run--panel ${toolRunGroupKindClassName(kind)} chat-tool-run--${run.status}`}
        summary={summaryNode}
      >
        <div className="chat-tool-run__body">{nestedDetails}</div>
      </ToolRunDisclosure>
    );
  }
  return (
    <div className={`chat-tool-run chat-tool-run--flat ${toolRunGroupKindClassName(kind)} chat-tool-run--${run.status}`}>
      <div className="chat-tool-run__summary">
        {summaryNode}
      </div>
    </div>
  );
}

function FileMutationRunRow({
  run,
  nestedDetails,
  onAnswerApproval,
}: {
  run: RuntimeToolRun;
  nestedDetails?: ReactNode;
  onAnswerApproval: AnswerApprovalHandler;
}) {
  const { t } = useI18n();
  const pendingApprovalId = isPendingApprovalRun(run) ? run.approvalId : undefined;
  const target = fileOperationTarget(run, t);
  const error = run.status === 'error' ? formatPreview(run.resultPreview ?? '') : '';
  const totals = isPreparingToolRun(run) ? null : fileOperationChangeTotals(run);
  const change = fileChangeFromToolRun(run);
  const summary = (
    <>
      <span className="chat-tool-run__icon">{toolRunIcon(run)}</span>
      <span className="chat-tool-run__summary-text">
        <span className="chat-tool-run__file-status">
          <span>{fileOperationVerb(run, t)}</span>
          {target ? (
            <>
              <FileOperationTarget target={target} />
              <ChangeCounts additions={totals?.additions} deletions={totals?.deletions} showZero={totals?.showZero} />
            </>
          ) : null}
        </span>
      </span>
    </>
  );

  if (change?.lines.length) {
    return (
      <ToolRunDisclosure
        autoOpenKey={pendingApprovalDisclosureKey([run])}
        className={`chat-tool-run chat-tool-run--panel ${toolRunGroupKindClassName('fileMutation')} chat-tool-run--${run.status}`}
        lazy
        summary={summary}
      >
        <div className="chat-tool-run__body chat-tool-run__body--file-diff">
          <RuntimeFileDiffPreview change={change} />
          <RuntimeToolApprovalControl
            approvalId={pendingApprovalId}
            run={run}
            onAnswerApproval={onAnswerApproval}
          />
          {error ? <div className="chat-tool-run__file-error">{error}</div> : null}
          <HookRunList runs={run.hookRuns} />
          {nestedDetails}
        </div>
      </ToolRunDisclosure>
    );
  }

  if (nestedDetails) {
    return (
      <ToolRunDisclosure
        autoOpenKey={pendingApprovalDisclosureKey([run])}
        className={`chat-tool-run chat-tool-run--panel ${toolRunGroupKindClassName('fileMutation')} chat-tool-run--${run.status}`}
        summary={summary}
      >
        <div className="chat-tool-run__body">
          <RuntimeToolApprovalControl
            approvalId={pendingApprovalId}
            run={run}
            onAnswerApproval={onAnswerApproval}
          />
          {error ? <div className="chat-tool-run__file-error">{error}</div> : null}
          <HookRunList runs={run.hookRuns} />
          {nestedDetails}
        </div>
      </ToolRunDisclosure>
    );
  }

  return (
    <div className={`chat-tool-run chat-tool-run--flat ${toolRunGroupKindClassName('fileMutation')} chat-tool-run--${run.status}`}>
      <div className="chat-tool-run__summary">
        {summary}
      </div>
      <RuntimeToolApprovalControl
        approvalId={pendingApprovalId}
        run={run}
        onAnswerApproval={onAnswerApproval}
      />
      {error ? <div className="chat-tool-run__file-error">{error}</div> : null}
      <HookRunList runs={run.hookRuns} />
    </div>
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
          <span aria-hidden="true" className="chat-tool-run__icon chat-tool-run__detail-icon">
            {inspectionEntryIcon(entry.kind)}
          </span>
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
  const stableEntriesByPath = new Map(fileOperationStableChangeEntries(runs)
    .map((entry) => [normalizeFileOperationPath(entry.path), entry]));
  const changesByPath = fileChangesByPath(runs);
  if (!entries.length) return null;
  return (
    <ul className="chat-tool-run__inspection-list chat-tool-run__file-operation-list">
      {entries.map((entry) => {
        const change = changesByPath.get(normalizeFileOperationPath(entry.path));
        const stableEntry = stableEntriesByPath.get(normalizeFileOperationPath(entry.path));
        const summary = (
          <>
            <span aria-hidden="true" className="chat-tool-run__icon chat-tool-run__detail-icon">
              {toolRunKindIcon('fileMutation')}
            </span>
            <span>{fileOperationActionLabel(entry.action, t)}</span>
            <WorkspaceFileLink
              className="chat-tool-run__file-list-target"
              filePath={entry.path}
              linkKind="workspace-tool"
              onClick={change?.lines.length ? (event) => event.stopPropagation() : undefined}
            >
              {pathBaseName(entry.path, t)}
            </WorkspaceFileLink>
            <ChangeCounts
              additions={stableEntry?.additions}
              deletions={stableEntry?.deletions}
              showZero={stableEntry?.showZeroChangeCounts}
            />
          </>
        );
        return change?.lines.length ? (
          <li className="chat-file-diff__item" key={`${entry.action}:${entry.path}`}>
            <RuntimeFileDiffDisclosure change={change} summary={summary} />
          </li>
        ) : (
          <li className="chat-tool-run__inspection-item" key={`${entry.action}:${entry.path}`}>
            {summary}
          </li>
        );
      })}
    </ul>
  );
}

function fileChangesByPath(runs: RuntimeToolRun[]): Map<string, RuntimeFileChange> {
  const changes = new Map<string, RuntimeFileChange>();
  for (const run of runs) {
    for (const change of fileChangesFromToolRun(run)) {
      changes.set(normalizeFileOperationPath(change.path), change);
    }
  }
  return changes;
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
  const approvalActions = run.userInput && pendingApprovalId
    ? <RuntimeUserInputActions approvalId={pendingApprovalId} run={run} onAnswerApproval={onAnswerApproval} />
    : run.elicitation && pendingApprovalId
      ? <McpElicitationActions approvalId={pendingApprovalId} run={run} onAnswerApproval={onAnswerApproval} />
      : (
          <RuntimeToolApprovalControl
            approvalId={pendingApprovalId}
            run={run}
            onAnswerApproval={onAnswerApproval}
          />
        );
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
    const changes = fileChangesFromToolRun(run);
    const singleChange = changes.length === 1 ? changes[0] : undefined;
    return (
      <>
        {changes.length > 1
          ? <FileOperationTargetList runs={[run]} />
          : singleChange?.lines.length
            ? <RuntimeFileDiffPreview change={singleChange} />
            : null}
        {run.status === 'error' && run.resultPreview ? <div className="chat-tool-run__file-error">{formatPreview(run.resultPreview)}</div> : null}
        {execPolicySummary ? <ToolPreview label={t('toolRun.preview.execPolicy')} value={execPolicySummary} /> : null}
        {networkSummary ? <ToolPreview label={t('toolRun.preview.network')} value={networkSummary} /> : null}
        {permissionSummary ? <ToolPreview label={t('toolRun.preview.permission')} value={permissionSummary} /> : null}
        {hookRuns}
        {approvalActions}
      </>
    );
  }
  const diagnostic = displayedGenericToolRunDiagnostic(run, t);
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

function toolRunHasDetails(run: RuntimeToolRun, pendingApprovalId: string | undefined, t: Translate): boolean {
  if (isShellRun(run) || toolRunGroupKind(run) === 'inspection' || isFileOperationRun(run)) return true;
  if (pendingApprovalId) return true;
  if (run.proposedExecPolicyAmendment?.length) return true;
  if (run.networkApprovalContext) return true;
  if (run.permissionApprovalContext) return true;
  if (run.hookRuns?.length) return true;
  if (run.approvalReviewAssessment?.status === 'denied') return true;
  return Boolean(displayedGenericToolRunDiagnostic(run, t));
}

function displayedGenericToolRunDiagnostic(run: RuntimeToolRun, t: Translate): string {
  const diagnostic = genericToolRunDiagnostic(run);
  if (!diagnostic) return '';

  // Terminal summaries already carry the status and tool label. Suppress only
  // their exact boilerplate; policy explanations and other diagnostics remain
  // available behind the disclosure.
  if (toolRunSummary(run, t).title.includes(diagnostic)) return '';
  if (run.status === 'cancelled' && /^Turn cancelled(?: by approval decision)?\.?$/iu.test(diagnostic)) return '';
  if (run.status === 'rejected' && /^Tool\s+.+?\s+was rejected(?: by runtime policy)?\.?$/iu.test(diagnostic)) return '';

  const assessment = run.approvalReviewAssessment;
  if (
    assessment?.status === 'denied'
    && [assessment.rationale, assessment.riskSummary, assessment.potentialImpact]
      .some((value) => value?.trim() === diagnostic)
  ) {
    return '';
  }
  return diagnostic;
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

export {
  FileChangesSummaryCard,
} from './RuntimeFileChangesSummaryCard.js';
export {
  groupToolRuns,
  toolRunDisplayStableKey,
} from './RuntimeToolRunPresentation.js';
