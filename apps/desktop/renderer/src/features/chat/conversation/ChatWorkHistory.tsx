import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import { ChevronDown } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useI18n, type Translate } from '../../../shared/i18n/I18nProvider.js';
import type { WorkHistoryExpandedChangeHandler } from './chat-workspace-types.js';
import { hasThinkingSegments } from './chatThinkingContent.js';
import { shouldCollapseCompletedWorkHistory } from './chatWorkHistoryState.js';

export function ActiveWorkPlaceholder({
  children,
  segments,
  showLoading = true,
}: {
  children?: ReactNode;
  segments: RuntimeMessage[];
  showLoading?: boolean;
}) {
  const { t } = useI18n();

  return (
    <WorkHistoryPanel active completedAtMs={null} hasDetails={Boolean(children) || showLoading} startedAtMs={inferActiveTurnStartedAtMs(segments)}>
      {children}
      {/* runtime 尚未产出内容时，在工作区内保留明确的进行中反馈。 */}
      {showLoading ? <AssistantLoadingIndicator label={t('chat.assistant.processing')} showLabel={false} /> : null}
    </WorkHistoryPanel>
  );
}

export function inferWorkTiming(segments: RuntimeMessage[]): {
  startedAtMs: number | null;
  completedAtMs: number | null;
} {
  const startedAtMs: number[] = [];
  const completedAtMs: number[] = [];
  let hasWorkEvidence = false;

  for (const segment of segments) {
    const segmentStartedAtMs = parseDateMs(segment.createdAt);
    const segmentCompletedAtMs = parseDateMs(segment.completedAt);
    if (hasThinkingSegments(segment.content) || segment.streamParts?.some((part) => (
      part.type === 'reasoning' && Boolean(part.content.trim())
    ))) {
      hasWorkEvidence = true;
      if (segmentStartedAtMs !== null) startedAtMs.push(segmentStartedAtMs);
      if (segmentCompletedAtMs !== null) completedAtMs.push(segmentCompletedAtMs);
    }

    for (const run of segment.toolRuns ?? []) {
      hasWorkEvidence = true;
      const runStartedAtMs = parseDateMs(run.startedAt) ?? segmentStartedAtMs;
      const runCompletedAtMs = parseDateMs(run.completedAt);
      if (runStartedAtMs !== null) startedAtMs.push(runStartedAtMs);
      if (runCompletedAtMs !== null) completedAtMs.push(runCompletedAtMs);
    }
  }

  if (!startedAtMs.length && hasWorkEvidence) {
    for (const segment of segments) {
      const segmentStartedAtMs = parseDateMs(segment.createdAt);
      if (segmentStartedAtMs !== null) {
        startedAtMs.push(segmentStartedAtMs);
        break;
      }
    }
  }

  return {
    startedAtMs: startedAtMs.length ? Math.min(...startedAtMs) : null,
    completedAtMs: completedAtMs.length ? Math.max(...completedAtMs) : null,
  };
}

export function WorkHistoryPanel({
  active,
  children,
  collapseWhenContentFollows = false,
  completedAtMs,
  defaultExpanded = active,
  hasDetails,
  onExpandedChange,
  panelId,
  persistentChildren,
  startedAtMs,
}: {
  active: boolean;
  children?: ReactNode;
  collapseWhenContentFollows?: boolean;
  completedAtMs?: number | null;
  defaultExpanded?: boolean;
  hasDetails: boolean;
  onExpandedChange?: WorkHistoryExpandedChangeHandler;
  panelId?: string;
  /** 折叠时仍需保留的时间线节点，由 Feature 结果视图按需声明。 */
  persistentChildren?: ReactNode;
  startedAtMs?: number | null;
}) {
  const { t } = useI18n();
  const wasActiveForTimingRef = useRef(active);
  const wasActiveForExpansionRef = useRef(active);
  const hadFollowingContentRef = useRef(collapseWhenContentFollows);
  const hasEverHadDetailsRef = useRef(hasDetails);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [capturedCompletedAtMs, setCapturedCompletedAtMs] = useState<number | null>(() => completedAtMs ?? null);
  // 流式更新只允许“后续正文首次出现”和“整个 turn 完成”各触发一次自动收起，
  // 其余时间由用户手动控制展开状态。
  const [manualExpanded, setManualExpanded] = useState(() => hasDetails && defaultExpanded);
  const expanded = hasDetails && manualExpanded;

  useEffect(() => {
    if (completedAtMs !== null && completedAtMs !== undefined) {
      setCapturedCompletedAtMs(completedAtMs);
    } else if (active) {
      setCapturedCompletedAtMs(null);
    } else if (wasActiveForTimingRef.current) {
      setCapturedCompletedAtMs((value) => value ?? Date.now());
    }
    wasActiveForTimingRef.current = active;
  }, [active, completedAtMs]);

  useLayoutEffect(() => {
    const shouldCollapseForFollowingContent = collapseWhenContentFollows && !hadFollowingContentRef.current;
    const shouldCollapseForCompletedTurn = shouldCollapseCompletedWorkHistory({
      defaultExpanded,
      runActive: active,
      wasActive: wasActiveForExpansionRef.current,
    });
    if (shouldCollapseForFollowingContent || shouldCollapseForCompletedTurn) {
      // Final content replaces transient progress as the primary transcript surface.
      setManualExpanded(false);
    } else if (hasDetails && !hasEverHadDetailsRef.current && defaultExpanded) {
      // A panel can mount with only persistent subagent cards. Expand once when ordinary
      // work details first arrive, without overriding a later manual collapse.
      setManualExpanded(true);
    }
    if (hasDetails) hasEverHadDetailsRef.current = true;
    hadFollowingContentRef.current = collapseWhenContentFollows;
    wasActiveForExpansionRef.current = active;
  }, [active, collapseWhenContentFollows, defaultExpanded, hasDetails]);

  useEffect(() => {
    if (!active) return undefined;
    const tick = () => setNowMs(Date.now());
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [active]);

  useEffect(() => {
    if (!panelId) return;
    onExpandedChange?.(panelId, expanded);
  }, [expanded, onExpandedChange, panelId]);

  useEffect(() => () => {
    if (panelId) onExpandedChange?.(panelId, false);
  }, [onExpandedChange, panelId]);

  const title = active ? t('chat.work.active') : t('chat.work.completed');
  const durationEndMs = active ? nowMs : (capturedCompletedAtMs ?? completedAtMs ?? null);
  const durationLabel = formatDurationMs(
    startedAtMs !== null && startedAtMs !== undefined && durationEndMs !== null
      ? Math.max(0, durationEndMs - startedAtMs)
      : null,
    t,
  );
  const summaryContent = (
    <>
      <span className="chat-work-history__title">{title}</span>
      {durationLabel ? <span className="chat-work-history__duration">{durationLabel}</span> : null}
      {hasDetails ? <ChevronDown aria-hidden="true" className="chat-work-history__chevron" size={12} /> : null}
    </>
  );
  const visibleBody = expanded && hasDetails ? children : persistentChildren;

  return (
    <div className={`chat-work-history ${expanded ? 'is-expanded' : ''} ${hasDetails ? 'is-toggleable' : ''}`}>
      {hasDetails ? (
        <button className="chat-work-history__summary" type="button" aria-expanded={expanded} title={expanded ? t('chat.work.collapse') : t('chat.work.expand')} onClick={() => setManualExpanded((value) => !value)}>
          {summaryContent}
        </button>
      ) : (
        <div className="chat-work-history__summary">{summaryContent}</div>
      )}
      {visibleBody ? <div className="chat-work-history__body">{visibleBody}</div> : null}
    </div>
  );
}

export function AssistantLoadingIndicator({ label, showLabel = true }: { label: string; showLabel?: boolean }) {
  return (
    <div className="chat-assistant-loading" aria-label={label} aria-live="polite">
      <span className="chat-assistant-loading__dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      {showLabel ? <span>{label}</span> : null}
    </div>
  );
}

function inferActiveTurnStartedAtMs(segments: RuntimeMessage[]): number | null {
  const startedAtMs: number[] = [];
  for (const segment of segments) {
    const segmentStartedAtMs = parseDateMs(segment.createdAt);
    if (segmentStartedAtMs !== null) startedAtMs.push(segmentStartedAtMs);
    for (const run of segment.toolRuns ?? []) {
      const runStartedAtMs = parseDateMs(run.startedAt);
      if (runStartedAtMs !== null) startedAtMs.push(runStartedAtMs);
    }
  }
  return startedAtMs.length ? Math.min(...startedAtMs) : null;
}

function parseDateMs(value?: string | null): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function formatDurationMs(value: number | null, t: Translate): string {
  if (value === null || value < 0) return '';
  const roundedSeconds = Math.round(value / 1000);
  const totalSeconds = value > 0 && roundedSeconds === 0 ? 1 : Math.max(0, roundedSeconds);
  if (totalSeconds < 60) return t('chat.duration.seconds', { seconds: totalSeconds });
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return seconds
      ? t('chat.duration.minutesSeconds', { minutes, seconds })
      : t('chat.duration.minutes', { minutes });
  }
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes
    ? t('chat.duration.hoursMinutes', { hours, minutes: restMinutes })
    : t('chat.duration.hours', { hours });
}
