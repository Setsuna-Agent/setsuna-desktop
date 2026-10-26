import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';

export type GoalCompletionCheck = Readonly<{
  requirement: string;
  passed: boolean;
  evidenceIds: readonly string[];
  finding: string;
}>;

export type GoalCompletionVerification = Readonly<{
  goalId: string;
  objective: string;
  turnId: string;
  observedThroughSeq: number;
  attempt: number;
  passed: boolean;
  checks: readonly GoalCompletionCheck[];
  gaps: readonly string[];
}>;

export const goalCompletionVerificationCodec = defineRuntimeCodec<GoalCompletionVerification>(value => {
  if (!value || typeof value !== 'object') throw new Error('Invalid Goal verification.');
  const record = value as Record<string, unknown>;
  for (const key of ['goalId', 'objective', 'turnId'] as const) {
    if (typeof record[key] !== 'string' || !record[key]) throw new Error(`Invalid Goal verification ${key}.`);
  }
  if (!Number.isSafeInteger(record.observedThroughSeq) || (record.observedThroughSeq as number) < 0
    || !Number.isSafeInteger(record.attempt) || (record.attempt as number) < 1 || typeof record.passed !== 'boolean') throw new Error('Invalid Goal verification counters.');
  if (!Array.isArray(record.checks) || record.checks.length > 32) throw new Error('Invalid Goal verification checks.');
  const checks = record.checks.map((raw: unknown): GoalCompletionCheck => {
    if (!raw || typeof raw !== 'object') throw new Error('Invalid Goal completion check.');
    const check = raw as Record<string, unknown>;
    if (typeof check.requirement !== 'string' || !check.requirement.trim() || check.requirement.length > 2000
      || typeof check.passed !== 'boolean' || typeof check.finding !== 'string' || check.finding.length > 4000) throw new Error('Invalid Goal completion check fields.');
    return Object.freeze({ requirement: check.requirement, passed: check.passed, finding: check.finding,
      evidenceIds: stringList(check.evidenceIds, 16) });
  });
  const gaps = stringList(record.gaps, 32);
  if (record.passed && (!checks.length || gaps.length || checks.some(check => !check.passed || !check.evidenceIds.length))) throw new Error('Passing verification requires evidence for every check.');
  return Object.freeze({ goalId: record.goalId as string, objective: record.objective as string, turnId: record.turnId as string,
    observedThroughSeq: record.observedThroughSeq as number, attempt: record.attempt as number, passed: record.passed,
    checks: Object.freeze(checks), gaps });
});

function stringList(value: unknown, limit: number): readonly string[] {
  if (!Array.isArray(value) || value.length > limit || value.some(item => typeof item !== 'string' || !item.trim() || item.length > 4000)) throw new Error('Invalid Goal verification text list.');
  return Object.freeze([...value] as string[]);
}
