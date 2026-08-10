import type {
  RuntimeGoalLifecycleKind,
  RuntimeMessage,
  RuntimeThreadGoal,
} from '@setsuna-desktop/contracts';
import { Target } from 'lucide-react';
import { useI18n, type Translate } from '../../../shared/i18n/I18nProvider.js';

/** Compact transcript marker for durable Goal lifecycle transitions. */
export function GoalLifecycleMarker({ message }: { message: RuntimeMessage }) {
  const { t } = useI18n();
  const notice = message.goalMode;
  if (!notice) return null;
  const label = lifecycleLabel(notice.kind, t);
  const usage = goalUsage(notice.goal, t);

  return (
    <details className={`chat-goal-marker chat-goal-marker--${notice.kind}`}>
      <summary className="chat-goal-marker__summary">
        <Target size={13} strokeWidth={1.9} aria-hidden="true" />
        <span className="chat-goal-marker__label">{label}</span>
        <span className="chat-goal-marker__usage">{usage}</span>
      </summary>
      <div className="chat-goal-marker__detail">
        <p>{notice.goal.objective}</p>
        {notice.goal.stopReason?.message ? (
          <p className="chat-goal-marker__reason">{notice.goal.stopReason.message}</p>
        ) : null}
      </div>
    </details>
  );
}

function lifecycleLabel(kind: RuntimeGoalLifecycleKind, t: Translate): string {
  return t(`chat.goal.lifecycle.${kind}`);
}

function goalUsage(goal: RuntimeThreadGoal, t: Translate): string {
  const tokens = new Intl.NumberFormat().format(goal.tokensUsed);
  return t('chat.goal.usage.used', { tokens });
}
