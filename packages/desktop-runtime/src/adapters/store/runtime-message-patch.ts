import {
  normalizeRuntimeSkillReferences,
  type MessagePatch,
  type RuntimeMessage,
  type RuntimeSkillReference,
} from '@setsuna-desktop/contracts';

type NormalizedRuntimeMessagePatch = {
  content: string;
  skillIds: string[];
  skillReferences: RuntimeSkillReference[];
};

export function normalizeRuntimeMessagePatch(
  message: Pick<RuntimeMessage, 'content' | 'skillIds' | 'skillReferences'>,
  patch: MessagePatch,
): NormalizedRuntimeMessagePatch {
  const content = patch.content.trim();
  if (!content) throw new Error('Message content is required.');
  const skillIds = [...new Set((patch.skillIds ?? message.skillIds ?? [])
    .map((skillId) => skillId.trim())
    .filter(Boolean))];
  const referenceSource = patch.skillReferences !== undefined
    ? patch.skillReferences
    : content === message.content
      ? message.skillReferences
      : undefined;
  const skillReferences = normalizeRuntimeSkillReferences({
    content,
    references: referenceSource,
    skillIds,
  });
  return {
    content,
    skillIds,
    skillReferences,
  };
}
