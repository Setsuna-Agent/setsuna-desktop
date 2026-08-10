import type { RuntimeMessageAttachment } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { createChatComposerSendOptions } from '../../../../../src/features/chat/composer/chatComposerSendOptions.js';

describe('createChatComposerSendOptions', () => {
  it('keeps Plan semantics with attachments, skills, and thinking options for a queued turn', () => {
    expect(createChatComposerSendOptions({
      attachments: [imageAttachment],
      goalModeEnabled: false,
      planModeEnabled: true,
      selectedSkillIds: ['skill_review'],
      selectedSkillReferences: [{ skillId: 'skill_review', start: 0, end: 6 }],
      supportsImageInput: true,
      thinkingEffort: 'high',
      thinkingEnabled: true,
      thinkingSupported: true,
    })).toEqual({
      attachments: [imageAttachment],
      collaborationMode: 'plan',
      skillIds: ['skill_review'],
      skillReferences: [{ skillId: 'skill_review', start: 0, end: 6 }],
      thinking: true,
      thinkingEffort: 'high',
    });
  });

  it('keeps Goal semantics together with attachments and execution options', () => {
    expect(createChatComposerSendOptions({
      attachments: [imageAttachment, documentAttachment],
      goalModeEnabled: true,
      planModeEnabled: false,
      selectedSkillIds: ['skill_goal'],
      supportsImageInput: true,
      thinkingEffort: 'high',
      thinkingEnabled: true,
      thinkingSupported: true,
    })).toEqual({
      attachments: [imageAttachment, documentAttachment],
      goalMode: true,
      skillIds: ['skill_goal'],
      thinking: true,
      thinkingEffort: 'high',
    });
  });

  it('keeps runtime documents while filtering inline images for a text-only model', () => {
    expect(createChatComposerSendOptions({
      attachments: [imageAttachment, documentAttachment],
      goalModeEnabled: false,
      planModeEnabled: false,
      selectedSkillIds: [],
      supportsImageInput: false,
      thinkingEffort: '',
      thinkingEnabled: false,
      thinkingSupported: false,
    }).attachments).toEqual([documentAttachment]);
  });
});

const imageAttachment: RuntimeMessageAttachment = {
  id: 'image_1',
  name: 'guide.png',
  type: 'image/png',
  size: 128,
  url: 'data:image/png;base64,AA==',
};

const documentAttachment: RuntimeMessageAttachment = {
  id: 'attachment_1',
  assetId: 'attachment_1',
  source: 'runtime',
  name: 'guide.pdf',
  type: 'application/pdf',
  size: 512,
};
