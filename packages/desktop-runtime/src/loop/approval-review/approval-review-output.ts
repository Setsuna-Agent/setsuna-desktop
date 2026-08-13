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
const SAFE_NETWORK_ERROR_CODES = new Set([
  'CERT_HAS_EXPIRED',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENETUNREACH',
  'ENOTFOUND',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
]);

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

/** Produces persistence-safe audit text without copying model-authored action details. */
export function approvalReviewAuditRationale(
  review: ParsedApprovalReview,
  outcome: ParsedApprovalReview['outcome'],
): string {
  if (outcome !== review.outcome) {
    return `Runtime policy denied a ${review.riskLevel}-risk action with ${review.userAuthorization} user authorization.`;
  }
  const verb = outcome === 'allow' ? 'allowed' : 'denied';
  return `Automatic approval review ${verb} a ${review.riskLevel}-risk action with ${review.userAuthorization} user authorization.`;
}

/** Preserves useful failure categories without persisting provider-controlled text. */
export function approvalReviewTechnicalFailureRationale(error: unknown): string {
  const status = providerHttpStatus(error);
  if (status !== undefined) {
    return `Automatic approval review failed: Provider returned HTTP ${status}.`;
  }
  const networkCode = safeNetworkErrorCode(error);
  if (networkCode) {
    return `Automatic approval review failed: Provider connection failed (${networkCode}).`;
  }
  return 'Automatic approval review failed: Unexpected reviewer error.';
}

function stripThinking(value: string): string {
  return value.replace(/<think>[\s\S]*?<\/think>/giu, '');
}

function fencedJson(value: string): string | null {
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(value);
  return match?.[1]?.trim() || null;
}

function providerHttpStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const record = error as Record<string, unknown>;
  if (record.name !== 'ProviderRequestError') return undefined;
  return typeof record.status === 'number'
    && Number.isInteger(record.status)
    && record.status >= 100
    && record.status <= 599
    ? record.status
    : undefined;
}

function safeNetworkErrorCode(error: unknown, depth = 0): string | undefined {
  if (!error || typeof error !== 'object' || depth > 3) return undefined;
  const record = error as Record<string, unknown>;
  const code = typeof record.code === 'string' ? record.code.toUpperCase() : '';
  if (SAFE_NETWORK_ERROR_CODES.has(code)) return code;
  return safeNetworkErrorCode(record.cause, depth + 1);
}
