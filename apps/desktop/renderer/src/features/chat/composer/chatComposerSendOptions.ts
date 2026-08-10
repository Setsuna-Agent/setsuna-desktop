import {
  isRuntimeStoredMessageAttachment,
  type RuntimeCollaborationMode,
  type RuntimeMessageAttachment,
  type RuntimePlanDecision,
  type RuntimeSkillReference,
} from '@setsuna-desktop/contracts';

export type ChatComposerSendOptions = {
  attachments?: RuntimeMessageAttachment[];
  collaborationMode?: RuntimeCollaborationMode;
  goalMode?: boolean;
  planDecision?: RuntimePlanDecision;
  skillIds?: string[];
  skillReferences?: RuntimeSkillReference[];
  thinking?: boolean;
  thinkingEffort?: string;
};

export function createChatComposerSendOptions({
  attachments,
  goalModeEnabled,
  planModeEnabled,
  selectedSkillIds,
  selectedSkillReferences = [],
  supportsImageInput,
  thinkingEffort,
  thinkingEnabled,
  thinkingSupported,
}: {
  attachments: RuntimeMessageAttachment[];
  goalModeEnabled: boolean;
  planModeEnabled: boolean;
  selectedSkillIds: string[];
  selectedSkillReferences?: RuntimeSkillReference[];
  supportsImageInput: boolean;
  thinkingEffort: string;
  thinkingEnabled: boolean;
  thinkingSupported: boolean;
}): ChatComposerSendOptions {
  const thinking = thinkingSupported && thinkingEnabled;
  return {
    // 文档资源由 runtime 工具读取，不需要供应商提供视觉能力。
    attachments: attachments.filter((attachment) => supportsImageInput || isRuntimeStoredMessageAttachment(attachment)),
    skillIds: selectedSkillIds,
    ...(selectedSkillReferences.length ? { skillReferences: selectedSkillReferences } : {}),
    thinking,
    ...(thinking && thinkingEffort ? { thinkingEffort } : {}),
    // active turn 下会由发送动作持久化为独立的 Plan/Goal 队列项。
    ...(planModeEnabled ? { collaborationMode: 'plan' as const } : {}),
    ...(goalModeEnabled ? { goalMode: true } : {}),
  };
}
