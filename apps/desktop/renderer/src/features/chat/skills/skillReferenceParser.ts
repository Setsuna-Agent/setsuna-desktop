import type { RuntimeSkillSummary } from '@setsuna-desktop/contracts';

export type SkillReferenceTextPart =
  | { start: number; type: 'text'; value: string }
  | { skill: RuntimeSkillSummary; start: number; type: 'skill'; value: string };

type SkillReferenceCandidate = {
  order: number;
  skill: RuntimeSkillSummary;
  value: string;
};

export function skillDisplayText(skill: RuntimeSkillSummary): string {
  return skill.name.trim() || skill.id;
}

/**
 * Rebuild selected Skill references from durable IDs and their serialized labels.
 * IDs gate highlighting so ordinary text that happens to match a Skill name stays plain.
 */
export function parseSkillReferenceText(
  content: string,
  skillIds: string[] | undefined,
  skills: RuntimeSkillSummary[],
): SkillReferenceTextPart[] {
  const candidates = selectedSkillCandidates(skillIds, skills);
  if (!content || !candidates.length) {
    return content ? [{ start: 0, type: 'text', value: content }] : [];
  }

  const parts: SkillReferenceTextPart[] = [];
  const usedSkillIds = new Set<string>();
  let textStart = 0;
  let cursor = 0;

  while (cursor < content.length) {
    const candidate = candidates
      .filter(({ skill, value }) => (
        !usedSkillIds.has(skill.id)
        && content.startsWith(value, cursor)
        && isReferenceBoundary(content, cursor, cursor + value.length)
      ))
      .sort((left, right) => right.value.length - left.value.length || left.order - right.order)[0];

    if (!candidate) {
      cursor += 1;
      continue;
    }

    if (cursor > textStart) {
      parts.push({ start: textStart, type: 'text', value: content.slice(textStart, cursor) });
    }
    parts.push({
      skill: candidate.skill,
      start: cursor,
      type: 'skill',
      value: candidate.value,
    });
    usedSkillIds.add(candidate.skill.id);
    cursor += candidate.value.length;
    textStart = cursor;
  }

  if (textStart < content.length) {
    parts.push({ start: textStart, type: 'text', value: content.slice(textStart) });
  }
  return parts;
}

function selectedSkillCandidates(
  skillIds: string[] | undefined,
  skills: RuntimeSkillSummary[],
): SkillReferenceCandidate[] {
  const skillsById = new Map(skills.map((skill) => [skill.id, skill]));
  const seenIds = new Set<string>();
  const seenValues = new Set<string>();
  const candidates: SkillReferenceCandidate[] = [];

  for (const [order, skillId] of (skillIds ?? []).entries()) {
    if (seenIds.has(skillId)) continue;
    seenIds.add(skillId);
    const skill = skillsById.get(skillId);
    if (!skill) continue;
    const value = skillDisplayText(skill);
    if (!value || seenValues.has(value)) continue;
    seenValues.add(value);
    candidates.push({ order, skill, value });
  }
  return candidates;
}

function isReferenceBoundary(content: string, start: number, end: number): boolean {
  return isBoundaryCharacter(content.charAt(start - 1)) && isBoundaryCharacter(content.charAt(end));
}

function isBoundaryCharacter(character: string): boolean {
  return !character || /[\s\p{P}\p{S}]/u.test(character);
}
