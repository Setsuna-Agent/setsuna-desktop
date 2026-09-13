import type { ComposerSlot } from '../../../../../src/features/chat/composer/editor/types.js';
import type { RuntimeSkillSummary } from '@setsuna-desktop/contracts';
import { describe, expect, it, vi } from 'vitest';
import {
  ensureChatComposerCapabilitySlot,
  startChatComposerCapabilitySelection,
} from '../../../../../src/features/chat/composer/chatComposerCapabilitySelection.js';

const skill: RuntimeSkillSummary = {
  id: 'create-plugin-in-chat',
  name: '对话创建插件',
  kind: 'builtin',
  enabled: true,
};

describe('ensureChatComposerCapabilitySlot', () => {
  it('waits when the ChatPromptInput ref or its inner editor is not ready', () => {
    expect(ensureChatComposerCapabilitySlot(null, { kind: 'skill', value: skill })).toBe(false);
    expect(ensureChatComposerCapabilitySlot({}, { kind: 'skill', value: skill })).toBe(false);
  });

  it('focuses before insertion and only succeeds after the slot is observable', () => {
    let slots: ComposerSlot[] = [];
    const focus = vi.fn();
    const insert = vi.fn((nextSlots: ComposerSlot[]) => {
      slots = nextSlots;
    });
    const editor = {
      focus,
      getValue: () => ({ value: '', slotConfig: slots }),
      insert,
    };

    expect(ensureChatComposerCapabilitySlot(editor, { kind: 'skill', value: skill })).toBe(true);
    expect(focus).toHaveBeenCalledWith({ cursor: 'start', preventScroll: true });
    expect(insert).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({
        composerReference: { type: 'skill', skillId: skill.id },
        key: expect.stringMatching(/^skill:/),
      })]),
      'start',
      undefined,
      true,
    );
    expect(focus.mock.invocationCallOrder[0]).toBeLessThan(insert.mock.invocationCallOrder[0]);

    expect(ensureChatComposerCapabilitySlot(editor, { kind: 'skill', value: skill })).toBe(true);
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('reports a silent imperative insertion failure instead of consuming it', () => {
    const editor = {
      focus: vi.fn(),
      getValue: () => ({ value: '', slotConfig: [] }),
      insert: vi.fn(),
    };

    expect(ensureChatComposerCapabilitySlot(editor, { kind: 'skill', value: skill })).toBe(false);
  });

  it('inserts a distinct Skill slot when ordinary prose already contains its name', () => {
    const originalText = 'Do not use 对话创建插件';
    let slots: ComposerSlot[] = [{ type: 'text', value: originalText }];
    const insert = vi.fn((nextSlots: ComposerSlot[]) => {
      slots = nextSlots;
    });
    const editor = {
      focus: vi.fn(),
      getValue: () => ({ value: originalText, slotConfig: slots }),
      insert,
    };

    expect(ensureChatComposerCapabilitySlot(editor, { kind: 'skill', value: skill })).toBe(true);
    expect(insert).toHaveBeenCalledWith([
      expect.objectContaining({ composerReference: { type: 'skill', skillId: skill.id } }),
      { type: 'text', value: ' ' },
    ], 'start', undefined, true);
  });
});

describe('startChatComposerCapabilitySelection', () => {
  it('waits for a mounted editor before consuming its request', () => {
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrameId = 1;
    let ready = false;
    let slots: ComposerSlot[] = [];
    const insert = vi.fn((nextSlots: ComposerSlot[]) => {
      slots = nextSlots;
    });
    const onConfirmed = vi.fn();
    const stop = startChatComposerCapabilitySelection({
      getEditor: () => ready ? {
        getValue: () => ({ value: '', slotConfig: slots }),
        insert,
      } : null,
      onConfirmed,
      scheduler: {
        cancelFrame: (frameId) => frames.delete(frameId),
        requestFrame: (callback) => {
          const frameId = nextFrameId++;
          frames.set(frameId, callback);
          return frameId;
        },
      },
      selection: { kind: 'skill', value: skill },
    });
    const flushFrame = () => {
      const [frameId, callback] = frames.entries().next().value as [number, FrameRequestCallback];
      frames.delete(frameId);
      callback(0);
    };

    expect(insert).not.toHaveBeenCalled();
    flushFrame();
    expect(insert).not.toHaveBeenCalled();
    ready = true;
    flushFrame();
    expect(insert).toHaveBeenCalledTimes(1);
    expect(onConfirmed).toHaveBeenCalledTimes(1);

    stop();
    expect(frames.size).toBe(0);
  });
});
