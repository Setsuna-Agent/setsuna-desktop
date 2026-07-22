import {
  isRuntimeStoredMessageAttachment,
  type RuntimeCollaborationMode,
  type RuntimeMessageAttachment,
  type RuntimePlanDecision,
} from '@setsuna-desktop/contracts';

export type ChatComposerSendOptions = {
  attachments?: RuntimeMessageAttachment[];
  collaborationMode?: RuntimeCollaborationMode;
  goalMode?: boolean;
  planDecision?: RuntimePlanDecision;
  skillIds?: string[];
  thinking?: boolean;
  thinkingEffort?: string;
};

export function createChatComposerSendOptions({
  attachments,
  goalModeEnabled,
  planModeEnabled,
  selectedSkillIds,
  steering,
  supportsImageInput,
  thinkingEffort,
  thinkingEnabled,
  thinkingSupported,
}: {
  attachments: RuntimeMessageAttachment[];
  goalModeEnabled: boolean;
  planModeEnabled: boolean;
  selectedSkillIds: string[];
  steering: boolean;
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
    thinking,
    ...(thinking && thinkingEffort ? { thinkingEffort } : {}),
    // 计划/目标会创建新的执行语义，不能在已运行 turn 内改写；用户的选择保留到下一轮。
    ...(!steering && planModeEnabled ? { collaborationMode: 'plan' as const } : {}),
    ...(!steering && goalModeEnabled ? { goalMode: true } : {}),
  };
}
