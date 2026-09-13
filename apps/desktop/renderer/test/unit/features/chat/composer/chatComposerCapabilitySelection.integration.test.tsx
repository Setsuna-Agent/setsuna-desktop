// @vitest-environment happy-dom

import { ChatPromptInput } from '../../../../../src/features/chat/composer/editor/ChatPromptInput.js';
import { pluginMentionText, type RuntimePluginSummary, type RuntimeSkillSummary } from '@setsuna-desktop/contracts';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode, useCallback, useEffect, useRef, useState, type ComponentRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { CHAT_COMPOSER_CLIPBOARD_TYPE } from '../../../../../src/features/chat/composer/chatComposerClipboard.js';
import { createComposerDraftSyncPlan } from '../../../../../src/features/chat/composer/chatComposerDraftSync.js';
import {
  ensureChatComposerCapabilitySlot,
  startChatComposerCapabilitySelection,
  type ChatComposerCapabilitySelection,
} from '../../../../../src/features/chat/composer/chatComposerCapabilitySelection.js';
import {
  createSelectedSkillSlot,
  createSelectedPluginSlot,
  createPluginDraftSlots,
  createTextSlot,
  createWorkspaceMentionInsertion,
  createWorkspaceMentionReferenceSlot,
  filterSelectedSkillsBySlots,
} from '../../../../../src/features/chat/composer/chatComposerSlots.js';
import { useChatComposerClipboard } from '../../../../../src/features/chat/composer/useChatComposerClipboard.js';

const skill: RuntimeSkillSummary = {
  id: 'create-plugin-in-chat',
  name: '对话创建插件',
  kind: 'builtin',
  enabled: true,
};
const workspaceMentionPaths = ['package.json', 'README.md', 'Tree.md', 'tsconfig.json', 'pnpm-lock.yaml'];
const plugin: RuntimePluginSummary = {
  id: 'github', name: 'GitHub', installedAt: '2026-09-13',
  skills: [], mcpServers: [], hooks: [], hookCount: 0, resources: [],
};

afterEach(cleanup);

describe('chat composer capability selection with the real ChatPromptInput', () => {
  it('serializes a plugin without Skills and restores its tag without duplication after remounting', async () => {
    const selection: ChatComposerCapabilitySelection = { kind: 'plugin', value: plugin };
    const view = render(<ScheduledSkillSelectionHarness draft="查看仓库" selection={selection} />);
    const serialized = `${pluginMentionText(plugin)} 查看仓库`;
    await waitFor(() => expect(screen.getByTestId('serialized-draft').textContent).toBe(serialized));
    expect(screen.getByRole('textbox').textContent).toContain('GitHub');
    expect(screen.getByRole('textbox').textContent).not.toContain('$GitHub');
    expect(screen.getByRole('textbox').textContent).not.toContain('plugin://');
    view.unmount();
    render(<ScheduledSkillSelectionHarness draft={serialized} selection={selection} />);
    await waitFor(() => expect(screen.getByTestId('confirmed').textContent).toBe('true'));
    expect(screen.getByRole('textbox').querySelectorAll('[data-slot-key^="plugin:"]')).toHaveLength(1);
    expect(screen.getByTestId('serialized-draft').textContent).toBe(serialized);
  });

  it('keeps plugin identity together with Skill and file references when cutting and pasting', async () => {
    render(<StructuredClipboardHarness includePlugin />);
    const editor = screen.getByRole('textbox');
    const clipboardData = createClipboardData();
    const range = document.createRange();
    range.selectNodeContents(editor);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    fireEvent.cut(editor, { clipboardData });
    await waitFor(() => expect(editor.querySelector('[data-slot-key^="plugin:"]')).toBeNull());
    fireEvent.paste(editor, { clipboardData });
    await waitFor(() => {
      expect(editor.querySelectorAll('[data-slot-key^="plugin:"]')).toHaveLength(1);
      expect(editor.querySelectorAll('[data-slot-key^="skill:"]')).toHaveLength(1);
      expect(editor.querySelectorAll('[data-slot-key^="workspace:"]')).toHaveLength(1);
      expect(screen.getByTestId('serialized-draft').textContent).toBe(`${pluginMentionText(plugin)} 对话创建插件 @package.json`);
    });
  });

  it('renders the inserted Skill tag after a fresh ChatPromptInput mount', async () => {
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
    expect(screen.getByRole('textbox').querySelectorAll('[data-slot-key^="skill:"]')).toHaveLength(1);
    expect(screen.getByTestId('serialized-draft').textContent).toBe('对话创建插件 对话创建插件 existing draft');
  });

  it('retains the inserted Skill tag while its delayed value change reaches the parent', async () => {
    render(
      <StrictMode>
        <SkillSelectionDraftSyncHarness />
      </StrictMode>,
    );

    await waitFor(() => expect(screen.getByTestId('synced-draft').textContent).not.toBe(''));
    expect(screen.getByRole('textbox').querySelector('[data-slot-key^="skill:"]')).toBeTruthy();
  });

  it('restores Skill and workspace slots after cutting and pasting them', async () => {
    render(<StructuredClipboardHarness />);

    const editor = screen.getByRole('textbox');
    const clipboardData = createClipboardData();
    const range = document.createRange();
    range.selectNodeContents(editor);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);

    fireEvent.cut(editor, { clipboardData });

    expect(clipboardData.getData(CHAT_COMPOSER_CLIPBOARD_TYPE)).not.toBe('');
    await waitFor(() => {
      expect(editor.querySelector('[data-slot-key^="skill:"]')).toBeNull();
      expect(editor.querySelector('[data-slot-key^="workspace:"]')).toBeNull();
      expect(screen.getByTestId('selected-skills').textContent).toBe('');
    });

    fireEvent.paste(editor, { clipboardData });

    await waitFor(() => {
      expect(editor.querySelectorAll('[data-slot-key^="skill:"]')).toHaveLength(1);
      expect(editor.querySelectorAll('[data-slot-key^="workspace:"]')).toHaveLength(1);
      expect(screen.getByTestId('selected-skills').textContent).toBe(skill.id);
    });
  });

  it('uses distinct DOM slot identities when copied references are pasted again', async () => {
    render(<StructuredClipboardHarness />);

    const editor = screen.getByRole('textbox');
    const clipboardData = createClipboardData();
    const selectedContent = document.createRange();
    selectedContent.selectNodeContents(editor);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(selectedContent);
    fireEvent.copy(editor, { clipboardData });

    const endCursor = document.createRange();
    endCursor.selectNodeContents(editor);
    endCursor.collapse(false);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(endCursor);
    fireEvent.paste(editor, { clipboardData });

    await waitFor(() => {
      const skillSlots = Array.from(editor.querySelectorAll<HTMLElement>('[data-slot-key^="skill:"]'));
      const workspaceSlots = Array.from(editor.querySelectorAll<HTMLElement>('[data-slot-key^="workspace:"]'));
      expect(skillSlots).toHaveLength(2);
      expect(workspaceSlots).toHaveLength(2);
      expect(new Set(skillSlots.map((slot) => slot.dataset.slotKey)).size).toBe(2);
      expect(new Set(workspaceSlots.map((slot) => slot.dataset.slotKey)).size).toBe(2);
    });
  });

  it('inserts more than two workspace references through repeated external requests', async () => {
    render(<WorkspaceMentionRequestHarness />);

    for (const [index, path] of workspaceMentionPaths.entries()) {
      fireEvent.click(screen.getByRole('button', { name: `add ${path}` }));
      await waitFor(() => {
        expect(screen.getByRole('textbox').querySelectorAll('[data-slot-key^="workspace:"]'))
          .toHaveLength(index + 1);
      });
    }
  });

  it('preserves line breaks when structured references are cut and pasted', async () => {
    const expectedDraft = '第一行\n对话创建插件 @package.json\n最后一行';
    const expectedPlainText = '第一行\n对话创建插件 package.json\n最后一行';
    render(
      <StructuredClipboardHarness
        leadingText={'第一行\n'}
        trailingText={'\n最后一行'}
      />,
    );

    const editor = screen.getByRole('textbox');
    const clipboardData = createClipboardData();
    const range = document.createRange();
    range.selectNodeContents(editor);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);

    fireEvent.cut(editor, { clipboardData });

    expect(clipboardData.getData(CHAT_COMPOSER_CLIPBOARD_TYPE)).not.toBe('');
    expect(clipboardData.getData('text/plain')).toBe(expectedPlainText);

    fireEvent.paste(editor, { clipboardData });

    await waitFor(() => {
      expect(screen.getByTestId('serialized-draft').textContent).toBe(expectedDraft);
      expect(editor.querySelectorAll('[data-slot-key^="skill:"]')).toHaveLength(1);
      expect(editor.querySelectorAll('[data-slot-key^="workspace:"]')).toHaveLength(1);
    });
  });
});

function SkillSelectionHarness({ draft = '' }: { draft?: string }) {
  const editorRef = useRef<ComponentRef<typeof ChatPromptInput>>(null);
  const initialSlotConfigRef = useRef(draft ? [{ type: 'text' as const, value: draft }] : []);
  const [inserted, setInserted] = useState(false);

  useEffect(() => {
    setInserted(ensureChatComposerCapabilitySlot(editorRef.current, { kind: 'skill', value: skill }));
  }, []);

  return (
    <>
      <ChatPromptInput
        ref={editorRef}
        slotConfig={initialSlotConfigRef.current}
        value={draft}
      />
      <output data-testid="inserted">{String(inserted)}</output>
    </>
  );
}

function ScheduledSkillSelectionHarness({ draft: initialDraft, selection = { kind: 'skill', value: skill } }: {
  draft: string;
  selection?: ChatComposerCapabilitySelection;
}) {
  const editorRef = useRef<ComponentRef<typeof ChatPromptInput>>(null);
  const initialSlotConfigRef = useRef(createPluginDraftSlots(initialDraft, [plugin]));
  const [confirmed, setConfirmed] = useState(false);
  const [draft, setDraft] = useState(initialDraft);

  useEffect(() => startChatComposerCapabilitySelection({
    getEditor: () => editorRef.current,
    onConfirmed: () => setConfirmed(true),
    scheduler: timerFrameScheduler,
    selection,
  }), [selection]);

  return (
    <>
      <ChatPromptInput
        ref={editorRef}
        slotConfig={initialSlotConfigRef.current}
        value={draft}
        onChange={setDraft}
      />
      <output data-testid="serialized-draft">{draft}</output>
      <output data-testid="confirmed">{String(confirmed)}</output>
    </>
  );
}

function SkillSelectionDraftSyncHarness() {
  const editorRef = useRef<ComponentRef<typeof ChatPromptInput>>(null);
  const initialSlotConfigRef = useRef([]);
  const [draft, setDraft] = useState('');
  const lastEditorDraftRef = useRef(draft);
  const previousExternalDraftRef = useRef(draft);

  useEffect(() => {
    ensureChatComposerCapabilitySlot(editorRef.current, { kind: 'skill', value: skill });
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
      <ChatPromptInput
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

function StructuredClipboardHarness({
  leadingText = '',
  trailingText = '',
  includePlugin = false,
}: {
  leadingText?: string;
  trailingText?: string;
  includePlugin?: boolean;
}) {
  const editorRef = useRef<ComponentRef<typeof ChatPromptInput>>(null);
  const initialSlotsRef = useRef([
    ...(leadingText ? [createTextSlot(leadingText)] : []),
    ...(includePlugin ? [createSelectedPluginSlot(plugin), createTextSlot(' ')] : []),
    createSelectedSkillSlot(skill),
    createTextSlot(' '),
    createWorkspaceMentionReferenceSlot({
      kind: 'file',
      name: 'package.json',
      parent: '',
      path: 'package.json',
    }),
    ...(trailingText ? [createTextSlot(trailingText)] : []),
  ]);
  const [draft, setDraft] = useState(`${leadingText}${includePlugin ? `${pluginMentionText(plugin)} ` : ''}对话创建插件 @package.json${trailingText}`);
  const [selectedSkills, setSelectedSkills] = useState([skill]);
  const getEditor = useCallback(() => editorRef.current, []);
  const addSelectedSkills = useCallback((restoredSkills: RuntimeSkillSummary[]) => {
    setSelectedSkills((current) => {
      const ids = new Set(current.map((item) => item.id));
      return [...current, ...restoredSkills.filter((item) => !ids.has(item.id))];
    });
  }, []);
  const clipboardHandlers = useChatComposerClipboard({
    getEditor,
    onSkillsRestored: addSelectedSkills,
    skills: [skill],
    plugins: [plugin],
  });

  return (
    <div {...clipboardHandlers}>
      <ChatPromptInput
        ref={editorRef}
        slotConfig={initialSlotsRef.current}
        value={draft}
        onChange={(value, _event, slotConfig) => {
          setDraft(value);
          setSelectedSkills((current) => filterSelectedSkillsBySlots(current, slotConfig));
        }}
      />
      <output data-testid="serialized-draft">{draft}</output>
      <output data-testid="selected-skills">{selectedSkills.map((item) => item.id).join(',')}</output>
    </div>
  );
}

function WorkspaceMentionRequestHarness() {
  const editorRef = useRef<ComponentRef<typeof ChatPromptInput>>(null);
  const initialSlotsRef = useRef([]);
  const [draft, setDraft] = useState('');

  const addEntry = (path: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    const currentValue = editor.getValue();
    const insertion = createWorkspaceMentionInsertion({
      kind: 'file',
      name: path,
      parent: '',
      path,
    }, currentValue.value, currentValue.slotConfig);
    if (!insertion) return;
    editor.focus({ cursor: 'end', preventScroll: true });
    editor.insert(insertion.slots, 'end', insertion.replaceCharacters, true);
  };

  return (
    <>
      <ChatPromptInput
        ref={editorRef}
        slotConfig={initialSlotsRef.current}
        value={draft}
        onChange={setDraft}
      />
      {workspaceMentionPaths.map((path) => (
        <button key={path} type="button" onClick={() => addEntry(path)}>add {path}</button>
      ))}
    </>
  );
}

function createClipboardData(): DataTransfer {
  const values = new Map<string, string>();
  return {
    getData: (type: string) => values.get(type) ?? '',
    setData: (type: string, value: string) => {
      values.set(type, value);
    },
  } as DataTransfer;
}

const timerFrameScheduler = {
  cancelFrame: (frameId: number) => window.clearTimeout(frameId),
  requestFrame: (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0),
};
