import type { FeatureId, PackageVersion } from './definition.js';

export type FeatureCriticality = 'required' | 'optional';
export type FeatureActivationStatus = 'active' | 'degraded' | 'failed' | 'blocked';
export type FeatureLifecycleState =
  | 'declared'
  | 'starting'
  | 'active'
  | 'degraded'
  | 'draining'
  | 'stopped';

export type FeatureDiagnostic = Readonly<{
  code: string;
  message: string;
}>;

export type FeatureStatusSnapshot = Readonly<{
  featureId: FeatureId;
  version: PackageVersion;
  criticality: FeatureCriticality;
  status: FeatureActivationStatus;
  lifecycle: FeatureLifecycleState;
  diagnostic?: FeatureDiagnostic;
}>;

export interface FeatureHealthReporter {
  markActive(): void;
  markDegraded(diagnostic: FeatureDiagnostic): void;
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
  | 'CAPABILITY_MAJOR_MISMATCH'
  | 'DEPENDENCY_CYCLE';

export type FeatureCompositionIssue = Readonly<{
  code: FeatureCompositionIssueCode;
  message: string;
}>;

export class FeatureCompositionValidationError extends Error {
  readonly issues: readonly FeatureCompositionIssue[];

  constructor(issues: readonly FeatureCompositionIssue[]) {
    super(`Feature composition validation failed with ${issues.length} issue(s).`);
    this.name = 'FeatureCompositionValidationError';
    this.issues = Object.freeze([...issues]);
  }
}

export class FeatureReadinessError extends Error {
  readonly statuses: readonly FeatureStatusSnapshot[];

  constructor(statuses: readonly FeatureStatusSnapshot[]) {
    super('A required Feature failed to activate or was blocked by a required dependency.');
    this.name = 'FeatureReadinessError';
    this.statuses = Object.freeze([...statuses]);
  }
}
