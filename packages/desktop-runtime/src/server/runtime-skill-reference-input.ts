import type { RuntimeSkillReference } from '@setsuna-desktop/contracts';

export function runtimeSkillReferenceList(value: unknown): RuntimeSkillReference[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const candidate = item as Record<string, unknown>;
    if (
      typeof candidate.skillId !== 'string'
      || !Number.isInteger(candidate.start)
      || !Number.isInteger(candidate.end)
    ) {
      return [];
    }
    return [{
      skillId: candidate.skillId,
      start: candidate.start as number,
      end: candidate.end as number,
    }];
  });
}
