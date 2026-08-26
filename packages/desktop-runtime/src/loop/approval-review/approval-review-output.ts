import type {
  RuntimeApprovalReviewRiskLevel,
  RuntimeApprovalUserAuthorization,
} from '@setsuna-desktop/contracts';

export type ParsedApprovalReview = {
  outcome: 'allow' | 'deny';
  potentialImpact?: string;
  rationale: string;
  riskLevel: RuntimeApprovalReviewRiskLevel;
  userAuthorization: RuntimeApprovalUserAuthorization;
};

export const APPROVAL_REVIEW_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'outcome',
    'riskLevel',
    'userAuthorization',
    'rationale',
    'potentialImpact',
  ],
  properties: {
    outcome: { type: 'string', enum: ['allow', 'deny'] },
    riskLevel: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
    userAuthorization: {
      type: 'string',
      enum: ['unknown', 'low', 'medium', 'high'],
    },
    rationale: { type: 'string' },
    potentialImpact: { type: 'string' },
  },
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
const MAX_IMPACT_CHARS = 2_000;
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
  if (record.potentialImpact !== undefined && (typeof record.potentialImpact !== 'string' || !record.potentialImpact.trim())) return null;
  return {
    outcome: record.outcome,
    riskLevel: record.riskLevel as RuntimeApprovalReviewRiskLevel,
    userAuthorization: record.userAuthorization as RuntimeApprovalUserAuthorization,
    rationale: Array.from(record.rationale.trim()).slice(0, MAX_RATIONALE_CHARS).join(''),
    ...(typeof record.potentialImpact === 'string'
      ? { potentialImpact: Array.from(record.potentialImpact.trim()).slice(0, MAX_IMPACT_CHARS).join('') }
      : {}),
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

/** Keeps reviewer explanations useful without persisting obvious secret values or full argument payloads. */
export function approvalReviewDisplayText(value: string, actionArguments: unknown): string {
  let sanitized = value
    .replace(/\bBearer\s+\S+/giu, 'Bearer [redacted]')
    .replace(/\bBasic\s+\S+/giu, 'Basic [redacted]')
    .replace(/\bsk-[a-z0-9_-]+\b/giu, '[redacted api key]')
    .replace(/([?&](?:api[_-]?key|token|secret|password)=)[^&\s]+/giu, '$1[redacted]')
    .replace(/(https?:\/\/)[^/@\s:]+:[^/@\s]+@/giu, '$1[redacted]@')
    .replace(/((?:^|\s)(?:-u|--user)(?:=|\s+))(?:(?:"[^"]*")|(?:'[^']*')|\S+)/giu, '$1[redacted]')
    .replace(/(\b(?:api[_-]?key|authorization|credential|password|passwd|secret|token)\s*[=:]\s*)(?:(?:"[^"]*")|(?:'[^']*')|[^\s,;]+)/giu, '$1[redacted]');
  for (const sensitiveValue of sensitiveArgumentValues(actionArguments)) {
    sanitized = sanitized.replaceAll(sensitiveValue, '[redacted]');
  }
  return sanitized.trim();
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

function sensitiveArgumentValues(value: unknown, key = ''): string[] {
  if (typeof value === 'string') {
    if (value.length < 4) return [];
    return [...new Set([
      ...(sensitiveArgumentKey(key) || value.length >= 80 ? [value] : []),
      ...inlineSensitiveValues(value),
    ])];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => sensitiveArgumentValues(item, key));
  }
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([childKey, item]) => (
    sensitiveArgumentValues(item, childKey)
  ));
}

function sensitiveArgumentKey(key: string): boolean {
  return /(?:authorization|cookie|credential|password|passwd|private[_-]?key|secret|token|api[_-]?key)/iu.test(key);
}

function inlineSensitiveValues(value: string): string[] {
  const values: string[] = [];
  for (const match of value.matchAll(/\b(?:Basic|Bearer)\s+([^\s"']+)/giu)) {
    if (match[1]) values.push(match[1]);
  }
  for (const match of value.matchAll(/(?:^|\s)(?:-u|--user)(?:=|\s+)["']?([^\s"']+)["']?/giu)) {
    if (match[1]) values.push(match[1]);
  }
  for (const match of value.matchAll(/https?:\/\/([^/@\s]+)@/giu)) {
    if (match[1]) values.push(match[1]);
  }
  for (const match of value.matchAll(/\b(?:api[_-]?key|authorization|credential|password|passwd|secret|token)\s*[=:]\s*["']?([^\s"',;]+)/giu)) {
    if (match[1]) values.push(match[1]);
  }
  return values.filter((item) => item.length >= 3);
}

function fencedJson(value: string): string | null {
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(value);
  return match?.[1]?.trim() || null;
}

function providerHttpStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const record = error as Record<string, unknown>;
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
