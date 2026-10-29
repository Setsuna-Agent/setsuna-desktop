/** UTF-16 offsets into RuntimeMessage.content for one serialized Skill slot. */
export type RuntimeSkillReference = {
  skillId: string;
  start: number;
  end: number;
};

export function cloneRuntimeSkillReferences(
  references: RuntimeSkillReference[] | undefined,
): RuntimeSkillReference[] | undefined {
  return references?.map((reference) => ({ ...reference }));
}

/** Keep only ordered, non-overlapping references for Skills selected on this input. */
export function normalizeRuntimeSkillReferences({
  content,
  references,
  skillIds,
}: {
  content: string;
  references: RuntimeSkillReference[] | undefined;
  skillIds: string[];
}): RuntimeSkillReference[] {
  const selectedIds = new Set(skillIds);
  const ordered = (references ?? [])
    .map((reference, order) => ({
      order,
      skillId: reference.skillId.trim(),
      start: reference.start,
      end: reference.end,
    }))
    .filter((reference) => (
      selectedIds.has(reference.skillId)
      && Number.isInteger(reference.start)
      && Number.isInteger(reference.end)
      && reference.start >= 0
      && reference.end > reference.start
      && reference.end <= content.length
    ))
    .sort((left, right) => left.start - right.start || left.end - right.end || left.order - right.order);

  const normalized: RuntimeSkillReference[] = [];
  let previousEnd = 0;
  for (const reference of ordered) {
    if (reference.start < previousEnd) continue;
    normalized.push({
      skillId: reference.skillId,
      start: reference.start,
      end: reference.end,
    });
    previousEnd = reference.end;
  }
  return normalized;
}
