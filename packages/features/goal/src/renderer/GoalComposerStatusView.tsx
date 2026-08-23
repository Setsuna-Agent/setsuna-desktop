import { Input, Modal } from 'antd';
import { Pause, Pencil, Play, RefreshCw, Target, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type {
  ComposerStatusViewHostProps,
  RendererFeatureEventFeed,
} from '@setsuna-desktop/feature-core/renderer';
import type { FeatureScope } from '@setsuna-desktop/feature-core/scope';
import type { Goal, GoalPatch } from '../contracts/index.js';
import type { GoalClient } from './client.js';
import {
  GoalRendererController,
  type GoalRendererControllerSnapshot,
} from './controller.js';
import styles from './goal-composer-status.module.css';

const MAX_GOAL_OBJECTIVE_LENGTH = 4_000;
const INITIAL_SNAPSHOT: GoalRendererControllerSnapshot = Object.freeze({
  error: null,
  goal: null,
  loading: true,
  stale: false,
  throughSeq: 0,
});

export function GoalComposerStatusView({
  activeTurnStartedAt,
  client,
  feed,
  scope,
  threadId,
  translate,
}: ComposerStatusViewHostProps & Readonly<{
  client: GoalClient;
  feed: RendererFeatureEventFeed;
  scope: FeatureScope;
}>) {
  const controllerRef = useRef<GoalRendererController | null>(null);
  const [snapshot, setSnapshot] = useState(INITIAL_SNAPSHOT);

  useEffect(() => {
    const controller = new GoalRendererController({ client, feed, scope, threadId });
    controllerRef.current = controller;
    const unsubscribe = controller.subscribe(setSnapshot);
    controller.start();
    return () => {
      unsubscribe();
      controller.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [client, feed, scope, threadId]);

  if (snapshot.loading) return null;
  if (!snapshot.goal || snapshot.goal.status === 'complete') {
    return snapshot.error ? (
      <GoalUnavailableStatus error={snapshot.error} onRetry={() => controllerRef.current?.retry()} translate={translate} />
    ) : null;
  }
  return (
    <GoalStatus
      activeTurnStartedAt={activeTurnStartedAt}
      controller={() => controllerRef.current}
      goal={snapshot.goal}
      projectionError={snapshot.error}
      translate={translate}
    />
  );
}

function GoalStatus({
  activeTurnStartedAt,
  controller,
  goal,
  projectionError,
  translate,
}: Readonly<{
  activeTurnStartedAt?: string;
  controller(): GoalRendererController | null;
  goal: Goal;
  projectionError: string | null;
  translate: ComposerStatusViewHostProps['translate'];
}>) {
  const [editOpen, setEditOpen] = useState(false);
  const [draft, setDraft] = useState(goal.objective);
  const [pendingAction, setPendingAction] = useState<'clear' | 'edit' | 'status' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const elapsedSeconds = useGoalElapsedSeconds(goal, activeTurnStartedAt);
  const editable = draft.trim();

  useEffect(() => {
    if (!editOpen) setDraft(goal.objective);
  }, [editOpen, goal.objective]);

  const runAction = async (
    kind: NonNullable<typeof pendingAction>,
    action: (active: GoalRendererController) => Promise<void>,
  ) => {
    const active = controller();
    if (!active || pendingAction) return;
    setPendingAction(kind);
    setActionError(null);
    try {
      await action(active);
      if (kind === 'edit') setEditOpen(false);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingAction(null);
    }
  };
  const update = (patch: GoalPatch) => runAction('status', (active) => active.update(patch));

  return (
    <>
      <div
        className={`${styles.status} ${styles[goal.status] ?? ''}`}
        data-composer-status-view="goal"
        data-feature-id="goal"
      >
        <Target className={styles.target} size={14} strokeWidth={2} aria-hidden="true" />
        <strong>{translate(`feature.goal.status.${goal.status}`)}</strong>
        <span className={styles.objective} title={goal.objective}>{goal.objective}</span>
        <time
          className={styles.elapsed}
          aria-label={translate('feature.goal.elapsedLabel', { duration: formatGoalDuration(elapsedSeconds) })}
        >
          {formatGoalDuration(elapsedSeconds)}
        </time>
        <GoalIconButton
          label={translate('feature.goal.edit')}
          disabled={Boolean(pendingAction)}
          onClick={() => {
            setActionError(null);
            setDraft(goal.objective);
            setEditOpen(true);
          }}
        >
          <Pencil size={13} />
        </GoalIconButton>
        {goal.status === 'active' ? (
          <GoalIconButton
            label={translate('feature.goal.pause')}
            disabled={Boolean(pendingAction)}
            onClick={() => void update({ status: 'paused' })}
          >
            <Pause size={13} />
          </GoalIconButton>
        ) : (
          <GoalIconButton
            label={translate('feature.goal.resume')}
            disabled={Boolean(pendingAction)}
            onClick={() => void update({ status: 'active' })}
          >
            <Play size={13} />
          </GoalIconButton>
        )}
        <GoalIconButton
          label={translate('feature.goal.clear')}
          disabled={Boolean(pendingAction)}
          danger
          onClick={() => void runAction('clear', (active) => active.clear())}
        >
          <Trash2 size={13} />
        </GoalIconButton>
        {actionError || projectionError ? (
          <span className={styles.error} title={actionError ?? projectionError ?? undefined}>
            {actionError ?? translate('feature.goal.projectionUnavailable')}
          </span>
        ) : null}
      </div>
      <Modal
        centered
        className={styles.editorModal}
        width={440}
        open={editOpen}
        title={(
          <span className={styles.editorTitle}>
            <Target size={15} aria-hidden="true" />
            {translate('feature.goal.editTitle')}
          </span>
        )}
        closeIcon={<X size={15} />}
        mask={{ closable: !pendingAction }}
        keyboard={!pendingAction}
        closable={!pendingAction}
        onCancel={() => setEditOpen(false)}
        footer={(
          <div className={styles.editorActions}>
            <button type="button" disabled={Boolean(pendingAction)} onClick={() => setEditOpen(false)}>
              {translate('feature.goal.cancel')}
            </button>
            <button
              type="button"
              className={styles.primaryButton}
              disabled={Boolean(pendingAction) || !editable || editable === goal.objective}
              onClick={() => void runAction('edit', (active) => active.update({ objective: editable }))}
            >
              {pendingAction === 'edit'
                ? translate('feature.goal.processing')
                : translate('feature.goal.save')}
            </button>
          </div>
        )}
      >
        <div className={styles.editorInputShell}>
          <Input.TextArea
            autoFocus
            className={styles.editorInput}
            value={draft}
            maxLength={MAX_GOAL_OBJECTIVE_LENGTH}
            rows={9}
            placeholder={translate('feature.goal.editPlaceholder')}
            onChange={(event) => setDraft(event.currentTarget.value)}
          />
          <span className={styles.editorCount}>
            {draft.length} / {MAX_GOAL_OBJECTIVE_LENGTH}
          </span>
        </div>
        {actionError ? <p className={styles.editorError}>{actionError}</p> : null}
      </Modal>
    </>
  );
}

function GoalUnavailableStatus({
  error,
  onRetry,
  translate,
}: Readonly<{
  error: string;
  onRetry(): void;
  translate: ComposerStatusViewHostProps['translate'];
}>) {
  return (
    <div
      className={`${styles.status} ${styles.unavailable}`}
      data-composer-status-view="goal"
      data-feature-id="goal"
      role="status"
    >
      <Target className={styles.target} size={14} aria-hidden="true" />
      <span className={styles.objective} title={error}>{translate('feature.goal.projectionUnavailable')}</span>
      <GoalIconButton label={translate('feature.goal.retry')} disabled={false} onClick={onRetry}>
        <RefreshCw size={13} />
      </GoalIconButton>
    </div>
  );
}

function GoalIconButton({
  children,
  danger = false,
  disabled,
  label,
  onClick,
}: Readonly<{
  children: ReactNode;
  danger?: boolean;
  disabled: boolean;
  label: string;
  onClick(): void;
}>) {
  return (
    <button
      type="button"
      className={`${styles.action} ${danger ? styles.danger : ''}`}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function useGoalElapsedSeconds(goal: Goal, activeTurnStartedAt?: string): number {
  const [now, setNow] = useState(() => Date.now());
  const parsedStartedAt = activeTurnStartedAt ? Date.parse(activeTurnStartedAt) : Number.NaN;
  const activeStartedAt = goal.status === 'active' && Number.isFinite(parsedStartedAt)
    ? parsedStartedAt
    : null;

  useEffect(() => {
    if (activeStartedAt === null) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [activeStartedAt]);

  const activeSeconds = activeStartedAt === null
    ? 0
    : Math.max(0, Math.floor((now - activeStartedAt) / 1_000));
  return goal.timeUsedSeconds + activeSeconds;
}

function formatGoalDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainder = seconds % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}
