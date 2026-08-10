import type { RuntimeSkillReference, RuntimeSkillSummary } from '@setsuna-desktop/contracts';

export type SkillReferenceTextPart =
  | { start: number; type: 'text'; value: string }
  | { skill: RuntimeSkillSummary; start: number; type: 'skill'; value: string };

type SkillReferenceCandidate = {
  end: number;
  skill: RuntimeSkillSummary;
  start: number;
  value: string;
};

export function skillDisplayText(skill: RuntimeSkillSummary): string {
  return skill.name.trim() || skill.id;
}

/**
 * Rebuild selected Skill references from durable slot offsets. Exact ranges are required
 * because a Skill label can also occur as ordinary prose or belong to multiple Skill IDs.
 */
export function parseSkillReferenceText(
  content: string,
  skillReferences: RuntimeSkillReference[] | undefined,
  skills: RuntimeSkillSummary[],
): SkillReferenceTextPart[] {
  const candidates = selectedSkillCandidates(content, skillReferences, skills);
  if (!content || !candidates.length) {
    return content ? [{ start: 0, type: 'text', value: content }] : [];
  }

  const parts: SkillReferenceTextPart[] = [];
  let textStart = 0;

  for (const candidate of candidates) {
    if (candidate.start > textStart) {
      parts.push({ start: textStart, type: 'text', value: content.slice(textStart, candidate.start) });
    }
    parts.push({
      skill: candidate.skill,
      start: candidate.start,
      type: 'skill',
      value: candidate.value,
    });
    textStart = candidate.end;
  }

  if (textStart < content.length) {
    parts.push({ start: textStart, type: 'text', value: content.slice(textStart) });
  }
  return parts;
}

function selectedSkillCandidates(
  content: string,
  references: RuntimeSkillReference[] | undefined,
  skills: RuntimeSkillSummary[],
): SkillReferenceCandidate[] {
  const skillsById = new Map(skills.map((skill) => [skill.id, skill]));
  const candidates: SkillReferenceCandidate[] = [];
  let previousEnd = 0;

  for (const reference of [...(references ?? [])].sort((left, right) => left.start - right.start || left.end - right.end)) {
    const skill = skillsById.get(reference.skillId);
    if (!skill) continue;
    if (
      !Number.isInteger(reference.start)
      || !Number.isInteger(reference.end)
      || reference.start < 0
      || reference.start < previousEnd
      || reference.end <= reference.start
      || reference.end > content.length
    ) {
      continue;
    }
    const value = content.slice(reference.start, reference.end);
    if (!value) continue;
    candidates.push({
      end: reference.end,
      skill,
      start: reference.start,
      value,
    });
    previousEnd = reference.end;
  }
  return candidates;
}
