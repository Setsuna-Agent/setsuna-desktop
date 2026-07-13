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
});

const imageAttachment: RuntimeMessageAttachment = {
  id: 'image_1',
  name: 'guide.png',
  type: 'image/png',
  size: 128,
  url: 'data:image/png;base64,AA==',
};
