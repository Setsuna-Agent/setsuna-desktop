export type PackageSourceSavePlan =
  | { kind: 'invalid' }
  | { kind: 'unchanged'; displayValue: string }
  | { kind: 'persist'; displayValue: string; persistedValue: string | undefined };

type PackageSourceSavePlanInput = {
  defaultValue: string;
  draft: string;
  effectiveValue: string;
  normalize: (value: unknown) => string | null;
};

export function planPackageSourceSave({
  defaultValue,
  draft,
  effectiveValue,
  normalize,
}: PackageSourceSavePlanInput): PackageSourceSavePlan {
  const normalized = normalize(draft);
  if (normalized === null) return { kind: 'invalid' };

  const displayValue = normalized || defaultValue;
  if (displayValue === effectiveValue) return { kind: 'unchanged', displayValue };

  return {
    kind: 'persist',
    displayValue,
    persistedValue: displayValue === defaultValue ? undefined : displayValue,
  };
}
