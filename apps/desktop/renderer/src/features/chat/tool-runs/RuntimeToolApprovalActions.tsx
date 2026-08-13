import type {
  AnswerRuntimeApprovalInput,
  RuntimeApprovalAvailableDecision,
  RuntimeStructuredInputValue,
  RuntimeToolRun,
} from '@setsuna-desktop/contracts';
import { useState } from 'react';
import {
  useI18n,
  type Translate,
} from '../../../shared/i18n/I18nProvider.js';
import type { AnswerApprovalHandler } from './runtime-tool-run-types.js';
import {
  compactStructuredInputValues,
  RuntimeStructuredInputField,
  structuredInputDefaults,
} from './RuntimeStructuredInputField.js';

export function RuntimeToolApprovalControl({
  approvalId,
  run,
  onAnswerApproval,
}: {
  approvalId?: string;
  run: RuntimeToolRun;
  onAnswerApproval: AnswerApprovalHandler;
}) {
  const assessment = run.approvalReviewAssessment;
  const approvalPending = run.approvalStatus === 'pending'
    || (!run.approvalStatus && run.status === 'pending_approval');
  const showAutomaticReview = assessment?.status === 'failed'
    || assessment?.status === 'timed_out';
  const showUserActions = Boolean(
    approvalId
    && run.approvalReviewer !== 'automatic'
    && approvalPending,
  );
  if (!showAutomaticReview && !showUserActions) return null;

  return (
    <>
      {showAutomaticReview
        ? (
            <div className="chat-tool-run__approval">
              <AutomaticApprovalReviewResult run={run} />
            </div>
          )
        : null}
      {showUserActions && approvalId
        ? (
            <ApprovalActions
              approvalId={approvalId}
              availableDecisions={run.availableApprovalDecisions}
              onAnswerApproval={onAnswerApproval}
            />
          )
        : null}
    </>
  );
}

function AutomaticApprovalReviewResult({
  run,
}: {
  run: RuntimeToolRun;
}) {
  const { t } = useI18n();
  const assessment = run.approvalReviewAssessment;
  if (!assessment || (assessment.status !== 'failed' && assessment.status !== 'timed_out')) return null;
  const status = assessment.status;
  const label = status === 'timed_out'
    ? t('toolRun.approvalReview.timedOut')
    : t('toolRun.approvalReview.failed');
  const technicalDetail = approvalReviewTechnicalDetail(assessment.rationale);

  return (
    <div
      className={`chat-tool-run__approval-review chat-tool-run__approval-review--${status}`}
      role="status"
    >
      <span className="chat-tool-run__approval-review-label">{label}</span>
      {technicalDetail
        ? (
            <span className="chat-tool-run__approval-review-detail">
              {t('toolRun.approvalReview.detail', { detail: technicalDetail })}
            </span>
          )
        : null}
    </div>
  );
}

function approvalReviewTechnicalDetail(rationale: string): string {
  return rationale
    .replace(/^Automatic approval review failed:\s*/u, '')
    .trim();
}

export function ApprovalActions({
  approvalId,
  availableDecisions,
  onAnswerApproval,
}: {
  approvalId: string;
  availableDecisions?: RuntimeApprovalAvailableDecision[];
  onAnswerApproval: AnswerApprovalHandler;
}) {
  const { t } = useI18n();
  const [submittingDecisionKey, setSubmittingDecisionKey] = useState<
    string | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const decisions = availableDecisions?.length
    ? availableDecisions
    : defaultApprovalDecisions();

  const submit = async (decision: RuntimeApprovalAvailableDecision) => {
    if (submittingDecisionKey) return;
    const decisionKey = approvalDecisionKey(decision);
    setSubmittingDecisionKey(decisionKey);
    setError(null);
    try {
      await onAnswerApproval(
        approvalId,
        approvalInputFromDecision(decision),
      );
    } catch (unknownError) {
      setError(
        unknownError instanceof Error
          ? unknownError.message
          : String(unknownError),
      );
      setSubmittingDecisionKey(null);
    }
  };

  return (
    <div className="chat-tool-run__approval">
      <div className="chat-tool-run__actions">
        {decisions.map((decision) => {
          const decisionKey = approvalDecisionKey(decision);
          const decisionLabel = approvalDecisionLabel(decision, t);
          return (
            <button
              key={decisionKey}
              type="button"
              disabled={Boolean(submittingDecisionKey)}
              onClick={() => void submit(decision)}
            >
              {submittingDecisionKey === decisionKey
                ? t('toolRun.approval.submitting', {
                  decision: decisionLabel,
                })
                : decisionLabel}
            </button>
          );
        })}
      </div>
      {error
        ? <div className="chat-tool-run__action-error">{error}</div>
        : null}
    </div>
  );
}

export function McpElicitationActions({
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
  const [values, setValues] = useState<
    Record<string, RuntimeStructuredInputValue>
  >(() => (
    elicitation?.mode === 'form'
      ? structuredInputDefaults(elicitation.requestedSchema.properties)
      : {}
  ));
  const [submittingAction, setSubmittingAction] = useState<
    'accept' | 'decline' | 'cancel' | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  if (!elicitation) return null;

  const submit = async (action: 'accept' | 'decline' | 'cancel') => {
    if (submittingAction) return;
    setSubmittingAction(action);
    setError(null);
    try {
      const decision = action === 'accept'
        ? 'approve'
        : action === 'decline'
          ? 'reject'
          : 'cancel';
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
      setError(
        unknownError instanceof Error
          ? unknownError.message
          : String(unknownError),
      );
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
        <strong>
          {t(
            elicitation.mode === 'form'
              ? 'toolRun.elicitation.formTitle'
              : 'toolRun.elicitation.urlTitle',
          )}
        </strong>
        <span>{elicitation.serverKey}</span>
      </div>
      <p className="chat-tool-run__elicitation-message">
        {elicitation.message}
      </p>
      {elicitation.mode === 'form' ? (
        <div className="chat-tool-run__elicitation-fields">
          {Object.entries(elicitation.requestedSchema.properties).map(
            ([name, field]) => (
              <RuntimeStructuredInputField
                field={field}
                key={name}
                name={name}
                required={
                  elicitation.requestedSchema.required?.includes(name) === true
                }
                value={values[name]}
                onChange={(value) => {
                  setValues((current) => ({ ...current, [name]: value }));
                }}
              />
            ),
          )}
        </div>
      ) : (
        <code className="chat-tool-run__elicitation-url">
          {elicitation.displayUrl}
        </code>
      )}
      <div className="chat-tool-run__actions">
        <button type="submit" disabled={Boolean(submittingAction)}>
          {t(
            submittingAction === 'accept'
              ? 'toolRun.elicitation.submitting'
              : elicitation.mode === 'form'
                ? 'toolRun.elicitation.submit'
                : 'toolRun.elicitation.opening',
          )}
        </button>
        <button
          type="button"
          disabled={Boolean(submittingAction)}
          onClick={() => void submit('decline')}
        >
          {t(
            submittingAction === 'decline'
              ? 'toolRun.elicitation.declining'
              : 'toolRun.elicitation.decline',
          )}
        </button>
        <button
          type="button"
          disabled={Boolean(submittingAction)}
          onClick={() => void submit('cancel')}
        >
          {t(
            submittingAction === 'cancel'
              ? 'toolRun.elicitation.cancelling'
              : 'toolRun.elicitation.cancelTurn',
          )}
        </button>
      </div>
      {error
        ? <div className="chat-tool-run__action-error">{error}</div>
        : null}
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

function approvalDecisionKey(
  decision: RuntimeApprovalAvailableDecision,
): string {
  if (decision.type === 'approve_exec_policy_amendment') {
    return `${decision.type}:${decision.proposedExecPolicyAmendment.join(' ')}`;
  }
  if (decision.type === 'approve_network_policy_amendment') {
    return [
      decision.type,
      decision.networkPolicyAmendment.host,
      decision.networkPolicyAmendment.action,
    ].join(':');
  }
  return decision.type;
}

function approvalDecisionLabel(
  decision: RuntimeApprovalAvailableDecision,
  t: Translate,
): string {
  if (decision.type === 'approve') return t('toolRun.approval.approve');
  if (decision.type === 'approve_for_turn_with_strict_auto_review') {
    return t('toolRun.approval.strictReview');
  }
  if (decision.type === 'approve_for_session') {
    return t('toolRun.approval.session');
  }
  if (decision.type === 'approve_persistently') {
    return t('toolRun.approval.persistent');
  }
  if (decision.type === 'approve_exec_policy_amendment') {
    return t('toolRun.approval.execPolicy');
  }
  if (decision.type === 'approve_network_policy_amendment') {
    return t(
      decision.networkPolicyAmendment.action === 'deny'
        ? 'toolRun.approval.networkDeny'
        : 'toolRun.approval.networkAllow',
    );
  }
  if (decision.type === 'cancel') {
    return t('toolRun.approval.cancelTurn');
  }
  return t('toolRun.approval.reject');
}

function approvalInputFromDecision(
  decision: RuntimeApprovalAvailableDecision,
): AnswerRuntimeApprovalInput {
  if (decision.type === 'approve_exec_policy_amendment') {
    return {
      decision: decision.type,
      proposedExecPolicyAmendment: decision.proposedExecPolicyAmendment,
    };
  }
  if (decision.type === 'approve_network_policy_amendment') {
    return {
      decision: decision.type,
      networkPolicyAmendment: decision.networkPolicyAmendment,
    };
  }
  return { decision: decision.type };
}
