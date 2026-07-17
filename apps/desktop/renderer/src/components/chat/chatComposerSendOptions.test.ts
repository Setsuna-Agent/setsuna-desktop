import { describe, expect, it } from 'vitest';
import type { RuntimeMessageAttachment } from '@setsuna-desktop/contracts';
import { createChatComposerSendOptions } from './chatComposerSendOptions.js';

describe('createChatComposerSendOptions', () => {
  it('keeps steer-compatible attachments, skills, and thinking options during an active turn', () => {
    expect(createChatComposerSendOptions({
      attachments: [imageAttachment],
      goalModeEnabled: true,
      planModeEnabled: true,
      selectedSkillIds: ['skill_review'],
      steering: true,
      supportsImageInput: true,
      thinkingEffort: 'high',
      thinkingEnabled: true,
      thinkingSupported: true,
    })).toEqual({
      attachments: [imageAttachment],
      skillIds: ['skill_review'],
      thinking: true,
      thinkingEffort: 'high',
    });
  });

  it('adds new-turn-only modes to a regular send', () => {
    expect(createChatComposerSendOptions({
      attachments: [],
      goalModeEnabled: true,
      planModeEnabled: true,
      selectedSkillIds: [],
      steering: false,
      supportsImageInput: false,
      thinkingEffort: '',
      thinkingEnabled: false,
      thinkingSupported: true,
    })).toEqual({
      attachments: [],
      collaborationMode: 'plan',
      goalMode: true,
      skillIds: [],
      thinking: false,
    });
  });

  it('keeps runtime documents while filtering inline images for a text-only model', () => {
    expect(createChatComposerSendOptions({
      attachments: [imageAttachment, documentAttachment],
      goalModeEnabled: false,
      planModeEnabled: false,
      selectedSkillIds: [],
      steering: false,
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
