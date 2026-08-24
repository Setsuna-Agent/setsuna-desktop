import type { FeatureId } from './definition.js';

export type FeatureCriticality = 'required' | 'optional';
export type FeatureActivationStatus = 'active' | 'degraded' | 'failed';

export type FeatureDiagnostic = Readonly<{
  code: string;
  message: string;
}>;

export type FeatureStatusSnapshot = Readonly<{
  featureId: FeatureId;
  criticality: FeatureCriticality;
  status: FeatureActivationStatus;
  diagnostic?: FeatureDiagnostic;
}>;

export interface FeatureHealthReporter {
  /** A Feature is active only after every independently owned condition is cleared. */
  setCondition(conditionId: string, diagnostic: FeatureDiagnostic | null): void;
}

export class FeatureScopeUnavailableError extends Error {
  readonly code = 'FEATURE_UNAVAILABLE' as const;

  constructor(message = 'Feature is not accepting new operations.') {
    super(message);
    this.name = 'FeatureScopeUnavailableError';
  }
}

export class FeatureOperationCancelledError extends Error {
  readonly code = 'OPERATION_CANCELLED' as const;

  constructor(message = 'Feature operation was cancelled.') {
    super(message);
    this.name = 'FeatureOperationCancelledError';
  }
}

export type FeatureCompositionIssueCode =
  | 'DUPLICATE_FEATURE_ID'
  | 'DUPLICATE_CAPABILITY_PROVIDER'
  | 'MISSING_CAPABILITY'
  | 'DEPENDENCY_CYCLE'
  | 'DUPLICATE_RENDERER_MESSAGE_NAMESPACE'
  | 'DUPLICATE_RENDERER_MESSAGE_KEY'
  | 'DUPLICATE_RENDERER_CONTRIBUTION'
  | 'INVALID_RENDERER_CONTRIBUTION'
  | 'DUPLICATE_SETTINGS_DOCUMENT'
  | 'INVALID_SETTINGS_DOCUMENT'
  | 'INVALID_PRELOAD_BRIDGE';

export type FeatureCompositionIssue = Readonly<{
  code: FeatureCompositionIssueCode;
  message: string;
  /** Concrete Features involved in the invalid composition, when attribution is possible. */
  featureIds?: readonly FeatureId[];
}>;

export class FeatureCompositionValidationError extends Error {
  readonly issues: readonly FeatureCompositionIssue[];

  constructor(issues: readonly FeatureCompositionIssue[]) {
    const summary = issues[0]?.message;
    super(
      `Feature composition validation failed with ${issues.length} issue(s).`
      + (summary ? ` ${summary}` : ''),
    );
    this.name = 'FeatureCompositionValidationError';
    this.issues = Object.freeze(issues.map((issue) => Object.freeze({
      ...issue,
      ...(issue.featureIds ? { featureIds: Object.freeze([...issue.featureIds]) } : {}),
    })));
  }
}

export class FeatureReadinessError extends Error {
  readonly statuses: readonly FeatureStatusSnapshot[];

  constructor(statuses: readonly FeatureStatusSnapshot[]) {
    super('A required Feature failed to activate.');
    this.name = 'FeatureReadinessError';
    this.statuses = Object.freeze([...statuses]);
  }
}
