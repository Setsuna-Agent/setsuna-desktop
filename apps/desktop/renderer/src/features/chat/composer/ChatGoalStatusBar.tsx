import type { RuntimeThreadGoal, RuntimeThreadGoalPatch } from '@setsuna-desktop/contracts';
import { Input, Modal } from 'antd';
import {
  Pause,
  Pencil,
  Play,
  Target,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { formatGoalDuration } from '../goalFormatting.js';
import { Button } from '../../../shared/ui/primitives.js';

const MAX_GOAL_OBJECTIVE_LENGTH = 4_000;

export function ChatGoalStatusBar({
  activeTurnStartedAt,
  goal,
  onClearGoal,
  onUpdateGoal,
}: {
  activeTurnStartedAt?: string;
  goal: RuntimeThreadGoal;
  onClearGoal: () => void | Promise<unknown>;
  onUpdateGoal: (patch: RuntimeThreadGoalPatch) => void | Promise<unknown>;
}) {
  const { t } = useI18n();
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
    action: () => void | Promise<unknown>,
  ) => {
    if (pendingAction) return;
    setPendingAction(kind);
    setActionError(null);
    try {
      await action();
      if (kind === 'edit') setEditOpen(false);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <>
      <div className={`chat-goal-status chat-goal-status--${goal.status}`}>
        <Target className="chat-goal-status__target" size={14} strokeWidth={2} aria-hidden="true" />
        <strong>{t(`chat.goal.status.${goal.status}`)}</strong>
        <span className="chat-goal-status__objective" title={goal.objective}>{goal.objective}</span>
        <time className="chat-goal-status__elapsed" aria-label={t('chat.goal.elapsedLabel', { duration: formatGoalDuration(elapsedSeconds) })}>
          {formatGoalDuration(elapsedSeconds)}
        </time>
        <GoalIconButton
          label={t('chat.goal.edit')}
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
            label={t('chat.goal.pause')}
            disabled={Boolean(pendingAction)}
            onClick={() => void runAction('status', () => onUpdateGoal({ status: 'paused' }))}
          >
            <Pause size={13} />
          </GoalIconButton>
        ) : (
          <GoalIconButton
            label={t('chat.goal.resume')}
            disabled={Boolean(pendingAction)}
            onClick={() => void runAction('status', () => onUpdateGoal({ status: 'active' }))}
          >
            <Play size={13} />
          </GoalIconButton>
        )}
        <GoalIconButton
          label={t('chat.goal.clear')}
          disabled={Boolean(pendingAction)}
          danger
          onClick={() => void runAction('clear', onClearGoal)}
        >
          <Trash2 size={13} />
        </GoalIconButton>
        {actionError ? <span className="chat-goal-status__error" title={actionError}>{actionError}</span> : null}
      </div>
      <Modal
        centered
        width={440}
        open={editOpen}
        title={(
          <span className="chat-goal-editor__title">
            <Target size={15} aria-hidden="true" />
            {t('chat.goal.editTitle')}
          </span>
        )}
        closeIcon={<X size={15} />}
        mask={{ closable: !pendingAction }}
        keyboard={!pendingAction}
        closable={!pendingAction}
        onCancel={() => setEditOpen(false)}
        footer={(
          <div className="chat-goal-editor__actions">
            <Button disabled={Boolean(pendingAction)} onClick={() => setEditOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              disabled={Boolean(pendingAction) || !editable || editable === goal.objective}
              onClick={() => void runAction('edit', () => onUpdateGoal({ objective: editable }))}
            >
              {pendingAction === 'edit' ? t('common.processing') : t('common.save')}
            </Button>
          </div>
        )}
      >
        <div className="chat-goal-editor__input-shell">
          <Input.TextArea
            autoFocus
            className="chat-goal-editor__input"
            value={draft}
            maxLength={MAX_GOAL_OBJECTIVE_LENGTH}
            rows={9}
            placeholder={t('chat.goal.editPlaceholder')}
            onChange={(event) => setDraft(event.currentTarget.value)}
          />
          <span className="chat-goal-editor__count">
            {draft.length} / {MAX_GOAL_OBJECTIVE_LENGTH}
          </span>
        </div>
        {actionError ? <p className="chat-goal-editor__error">{actionError}</p> : null}
      </Modal>
    </>
  );
}

function GoalIconButton({
  children,
  danger = false,
  disabled,
  label,
  onClick,
}: {
  children: ReactNode;
  danger?: boolean;
  disabled: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`chat-goal-status__action ${danger ? 'is-danger' : ''}`}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function useGoalElapsedSeconds(goal: RuntimeThreadGoal, activeTurnStartedAt?: string): number {
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
