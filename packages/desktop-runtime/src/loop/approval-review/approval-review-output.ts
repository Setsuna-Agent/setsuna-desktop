import type {
  RuntimeApprovalReviewRiskLevel,
  RuntimeApprovalUserAuthorization,
} from '@setsuna-desktop/contracts';

export type ParsedApprovalReview = {
  outcome: 'allow' | 'deny';
  rationale: string;
  riskLevel: RuntimeApprovalReviewRiskLevel;
  userAuthorization: RuntimeApprovalUserAuthorization;
};

const RISK_LEVELS = new Set<RuntimeApprovalReviewRiskLevel>([
  'low',
  'medium',
  'high',
  'critical',
]);
const AUTHORIZATION_LEVELS = new Set<RuntimeApprovalUserAuthorization>([
  'unknown',
  'low',
  'medium',
  'high',
]);
const MAX_RATIONALE_CHARS = 2_000;

export function parseApprovalReviewOutput(value: string): ParsedApprovalReview | null {
  const normalized = stripThinking(value).trim();
  const json = fencedJson(normalized) ?? normalized;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (record.outcome !== 'allow' && record.outcome !== 'deny') return null;
  if (!RISK_LEVELS.has(record.riskLevel as RuntimeApprovalReviewRiskLevel)) return null;
  if (!AUTHORIZATION_LEVELS.has(record.userAuthorization as RuntimeApprovalUserAuthorization)) return null;
  if (typeof record.rationale !== 'string' || !record.rationale.trim()) return null;
  return {
    outcome: record.outcome,
    riskLevel: record.riskLevel as RuntimeApprovalReviewRiskLevel,
    userAuthorization: record.userAuthorization as RuntimeApprovalUserAuthorization,
    rationale: Array.from(record.rationale.trim()).slice(0, MAX_RATIONALE_CHARS).join(''),
  };
}

/** The model may explain risk, but it cannot override the runtime's hard matrix. */
export function policyConstrainedApprovalReviewOutcome(
  review: ParsedApprovalReview,
): ParsedApprovalReview['outcome'] {
  if (review.outcome === 'deny' || review.riskLevel === 'critical') return 'deny';
  if (
    review.riskLevel === 'high'
    && review.userAuthorization !== 'medium'
    && review.userAuthorization !== 'high'
  ) return 'deny';
  return 'allow';
}

function stripThinking(value: string): string {
  return value.replace(/<think>[\s\S]*?<\/think>/giu, '');
}

function fencedJson(value: string): string | null {
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(value);
  return match?.[1]?.trim() || null;
}
