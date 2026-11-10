import type { BrandIconConfig, RuntimeConfiguredModelReference } from '@setsuna-desktop/contracts';
import { assistantDraftCodec, type Assistant, type AssistantDraft } from '../contracts/index.js';

export type AssistantForm = {
  name: string;
  avatar?: BrandIconConfig;
  avatarColor?: string;
  personality: string;
  modelSelection?: RuntimeConfiguredModelReference;
  thinkingEffort: string;
  projectIds: string[];
  qqAppId: string;
  qqEnabled: boolean;
  qqMarkdownEnabled: boolean;
  /** Replacement only: revealing a saved secret never changes this draft. Empty keeps the stored secret. */
  qqSecret: string;
};

export function assistantForm(assistant?: Assistant): AssistantForm {
  return {
    name: assistant?.name ?? '',
    ...(assistant?.avatar ? { avatar: assistant.avatar } : {}),
    ...(assistant?.avatarColor ? { avatarColor: assistant.avatarColor } : {}),
    personality: assistant?.personality ?? '',
    ...(assistant?.modelSelection ? { modelSelection: assistant.modelSelection } : {}),
    thinkingEffort: assistant?.thinkingEffort ?? '',
    projectIds: assistant?.projectIds ?? [],
    qqAppId: assistant?.qq?.appId ?? '',
    qqEnabled: assistant?.qq?.enabled ?? true,
    qqMarkdownEnabled: assistant?.qq?.markdownEnabled !== false,
    qqSecret: '',
  };
}

export function draftFromForm(form: AssistantForm): AssistantDraft {
  const appId = form.qqAppId.trim();
  return assistantDraftCodec.parse({
    name: form.name, personality: form.personality, projectIds: form.projectIds,
    ...(form.avatar ? { avatar: form.avatar } : {}),
    ...(form.avatarColor ? { avatarColor: form.avatarColor } : {}),
    ...(form.modelSelection ? { modelSelection: form.modelSelection } : {}),
    ...(form.thinkingEffort ? { thinkingEffort: form.thinkingEffort } : {}),
    ...(appId ? { qq: { appId, enabled: form.qqEnabled, markdownEnabled: form.qqMarkdownEnabled } } : {}),
  });
}
