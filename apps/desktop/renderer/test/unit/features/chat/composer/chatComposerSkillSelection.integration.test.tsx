// @vitest-environment happy-dom

import { Sender } from '@ant-design/x';
import type { RuntimeSkillSummary } from '@setsuna-desktop/contracts';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { StrictMode, useEffect, useRef, useState, type ComponentRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { createComposerDraftSyncPlan } from '../../../../../src/features/chat/composer/chatComposerDraftSync.js';
import {
  ensureChatComposerSkillSlot,
  startChatComposerSkillSelection,
} from '../../../../../src/features/chat/composer/chatComposerSkillSelection.js';
import { createTextSlot } from '../../../../../src/features/chat/composer/chatComposerSlots.js';

const skill: RuntimeSkillSummary = {
  id: 'create-plugin-in-chat',
  name: '对话创建插件',
  kind: 'builtin',
  enabled: true,
  selected: false,
};

afterEach(cleanup);

describe('chat composer Skill selection with the real Sender', () => {
  it('renders the inserted Skill tag after a fresh Sender mount', async () => {
    render(<SkillSelectionHarness />);

    await waitFor(() => expect(screen.getByTestId('inserted').textContent).toBe('true'));
    expect(screen.getByText('对话创建插件')).toBeTruthy();
  });

  it('preserves ordinary matching text and inserts one distinct Skill tag', async () => {
    render(
      <StrictMode>
        <ScheduledSkillSelectionHarness draft="对话创建插件 existing draft" />
      </StrictMode>,
    );

    await waitFor(() => expect(screen.getByTestId('confirmed').textContent).toBe('true'));
    expect(screen.getByRole('textbox').querySelectorAll('[data-slot-key="skill:create-plugin-in-chat"]')).toHaveLength(1);
    expect(screen.getByRole('textbox').getAttribute('value')).toBe('对话创建插件 对话创建插件 existing draft');
  });

  it('retains the inserted Skill tag while its delayed value change reaches the parent', async () => {
    render(
      <StrictMode>
        <SkillSelectionDraftSyncHarness />
      </StrictMode>,
    );

    await waitFor(() => expect(screen.getByTestId('synced-draft').textContent).not.toBe(''));
    expect(screen.getByRole('textbox').querySelector('[data-slot-key="skill:create-plugin-in-chat"]')).toBeTruthy();
  });
});

function SkillSelectionHarness({ draft = '' }: { draft?: string }) {
  const editorRef = useRef<ComponentRef<typeof Sender>>(null);
  const initialSlotConfigRef = useRef(draft ? [{ type: 'text' as const, value: draft }] : []);
  const [inserted, setInserted] = useState(false);

  useEffect(() => {
    setInserted(ensureChatComposerSkillSlot(editorRef.current, skill));
  }, []);

  return (
    <>
      <Sender
        ref={editorRef}
        slotConfig={initialSlotConfigRef.current}
        value={draft}
      />
      <output data-testid="inserted">{String(inserted)}</output>
    </>
  );
}

function ScheduledSkillSelectionHarness({ draft: initialDraft }: { draft: string }) {
  const editorRef = useRef<ComponentRef<typeof Sender>>(null);
  const initialSlotConfigRef = useRef([{ type: 'text' as const, value: initialDraft }]);
  const [confirmed, setConfirmed] = useState(false);
  const [draft, setDraft] = useState(initialDraft);

  useEffect(() => startChatComposerSkillSelection({
    getEditor: () => editorRef.current,
    onConfirmed: () => setConfirmed(true),
    scheduler: timerFrameScheduler,
    skill,
  }), []);

  return (
    <>
      <Sender
        ref={editorRef}
        slotConfig={initialSlotConfigRef.current}
        value={draft}
        onChange={setDraft}
      />
      <output data-testid="confirmed">{String(confirmed)}</output>
    </>
  );
}

function SkillSelectionDraftSyncHarness() {
  const editorRef = useRef<ComponentRef<typeof Sender>>(null);
  const initialSlotConfigRef = useRef([]);
  const [draft, setDraft] = useState('');
  const lastEditorDraftRef = useRef(draft);
  const previousExternalDraftRef = useRef(draft);

  useEffect(() => {
    ensureChatComposerSkillSlot(editorRef.current, skill);
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const previousExternalDraft = previousExternalDraftRef.current;
    previousExternalDraftRef.current = draft;
    const syncPlan = createComposerDraftSyncPlan(
      draft,
      previousExternalDraft,
      lastEditorDraftRef.current,
      editor.getValue().value,
    );
    if (syncPlan.type === 'none') return;
    if (syncPlan.type === 'adopt') {
      lastEditorDraftRef.current = draft;
      return;
    }
    if (syncPlan.type === 'replace') editor.clear();
    if (syncPlan.value) editor.insert([createTextSlot(syncPlan.value)], 'end');
  }, [draft]);

  return (
    <>
      <Sender
        ref={editorRef}
        slotConfig={initialSlotConfigRef.current}
        value={draft}
        onChange={(value) => {
          lastEditorDraftRef.current = value;
          setDraft(value);
        }}
      />
      <output data-testid="synced-draft">{draft}</output>
    </>
  );
}

const timerFrameScheduler = {
  cancelFrame: (frameId: number) => window.clearTimeout(frameId),
  requestFrame: (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0),
};
