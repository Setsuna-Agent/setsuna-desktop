import type { SlotConfigType } from '@ant-design/x/es/sender';
import type { RuntimeSkillSummary } from '@setsuna-desktop/contracts';
import { describe, expect, it, vi } from 'vitest';
import {
  ensureChatComposerSkillSlot,
  startChatComposerSkillSelection,
  type ChatComposerSkillSelectionSession,
} from '../../../../../src/features/chat/composer/chatComposerSkillSelection.js';

const skill: RuntimeSkillSummary = {
  id: 'create-plugin-in-chat',
  name: '对话创建插件',
  kind: 'builtin',
  enabled: true,
  selected: false,
};

describe('ensureChatComposerSkillSlot', () => {
  it('waits when the Sender ref or its inner editor is not ready', () => {
    expect(ensureChatComposerSkillSlot(null, skill)).toBe(false);
    expect(ensureChatComposerSkillSlot({}, skill)).toBe(false);
  });

  it('focuses before insertion and only succeeds after the slot is observable', () => {
    let slots: SlotConfigType[] = [];
    const focus = vi.fn();
    const insert = vi.fn((nextSlots: SlotConfigType[]) => {
      slots = nextSlots;
    });
    const editor = {
      focus,
      getValue: () => ({ value: '', slotConfig: slots }),
      insert,
    };

    expect(ensureChatComposerSkillSlot(editor, skill)).toBe(true);
    expect(focus).toHaveBeenCalledWith({ cursor: 'start', preventScroll: true });
    expect(insert).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ key: 'skill:create-plugin-in-chat' })]),
      'start',
      undefined,
      true,
    );
    expect(focus.mock.invocationCallOrder[0]).toBeLessThan(insert.mock.invocationCallOrder[0]);

    expect(ensureChatComposerSkillSlot(editor, skill)).toBe(true);
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('records the exact range when a prior effect already inserted the slot', () => {
    const session: ChatComposerSkillSelectionSession = {};
    const slot = {
      type: 'tag' as const,
      key: 'skill:create-plugin-in-chat',
      props: { label: '对话创建插件', value: '对话创建插件' },
    };

    expect(ensureChatComposerSkillSlot({
      getValue: () => ({
        value: '  对话创建插件 existing draft',
        slotConfig: [{ type: 'text', value: '  ' }, slot, { type: 'text', value: ' existing draft' }],
      }),
      insert: vi.fn(),
    }, skill, session)).toBe(true);
    expect(session.serializedRange).toEqual({ start: 2, end: 8 });
  });

  it('reports a silent imperative insertion failure instead of consuming it', () => {
    const editor = {
      focus: vi.fn(),
      getValue: () => ({ value: '', slotConfig: [] }),
      insert: vi.fn(),
    };

    expect(ensureChatComposerSkillSlot(editor, skill)).toBe(false);
  });

  it('restores only the exact serialized range recorded by the selection session', () => {
    let slots: SlotConfigType[] = [{ type: 'text', value: '对话创建插件 existing draft' }];
    const focus = vi.fn();
    const insert = vi.fn((nextSlots: SlotConfigType[]) => {
      slots = nextSlots;
    });
    const editor = {
      focus,
      getValue: () => ({ value: '对话创建插件 existing draft', slotConfig: slots }),
      insert,
    };
    const session: ChatComposerSkillSelectionSession = {
      serializedRange: { start: 0, end: '对话创建插件'.length },
    };

    expect(ensureChatComposerSkillSlot(editor, skill, session)).toBe(true);
    expect(focus).toHaveBeenCalledWith({ cursor: 'all', preventScroll: true });
    expect(insert).toHaveBeenCalledWith([
      expect.objectContaining({ key: 'skill:create-plugin-in-chat' }),
      { type: 'text', value: ' existing draft' },
    ], 'cursor', undefined, true);
  });

  it('inserts a distinct Skill slot when ordinary prose already contains its name', () => {
    const originalText = 'Do not use 对话创建插件';
    let slots: SlotConfigType[] = [{ type: 'text', value: originalText }];
    const insert = vi.fn((nextSlots: SlotConfigType[]) => {
      slots = nextSlots;
    });
    const editor = {
      focus: vi.fn(),
      getValue: () => ({ value: originalText, slotConfig: slots }),
      insert,
    };

    expect(ensureChatComposerSkillSlot(editor, skill)).toBe(true);
    expect(insert).toHaveBeenCalledWith([
      expect.objectContaining({ key: 'skill:create-plugin-in-chat' }),
      { type: 'text', value: ' ' },
    ], 'start', undefined, true);
  });
});

describe('startChatComposerSkillSelection', () => {
  it('retries when Sender initialization removes an inserted slot before confirmation', () => {
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrameId = 1;
    let slots: SlotConfigType[] = [];
    const insert = vi.fn((nextSlots: SlotConfigType[]) => {
      slots = nextSlots;
    });
    const onConfirmed = vi.fn();
    const stop = startChatComposerSkillSelection({
      getEditor: () => ({
        getValue: () => ({ value: '', slotConfig: slots }),
        insert,
      }),
      onConfirmed,
      scheduler: {
        cancelFrame: (frameId) => frames.delete(frameId),
        requestFrame: (callback) => {
          const frameId = nextFrameId++;
          frames.set(frameId, callback);
          return frameId;
        },
      },
      skill,
    });
    const flushFrame = () => {
      const [frameId, callback] = frames.entries().next().value as [number, FrameRequestCallback];
      frames.delete(frameId);
      callback(0);
    };

    expect(insert).not.toHaveBeenCalled();
    flushFrame();
    expect(insert).toHaveBeenCalledTimes(1);
    slots = [];
    flushFrame();
    flushFrame();
    expect(insert).toHaveBeenCalledTimes(2);
    flushFrame();
    expect(onConfirmed).toHaveBeenCalledTimes(1);

    stop();
  });
});
