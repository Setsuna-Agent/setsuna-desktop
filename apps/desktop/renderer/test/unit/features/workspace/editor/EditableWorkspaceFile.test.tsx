// @vitest-environment happy-dom

import { FileRenderer, type HighlightedToken } from '@pierre/diffs';
import { Editor, TextDocument } from '@pierre/diffs/edit';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { EditableWorkspaceFile } from '../../../../../src/features/workspace/editor/EditableWorkspaceFile.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it.each(['test123', 'notes.txt', 'main.ts'])('retains edited rows when the renderer refreshes %s after a newline', async (name) => {
  const file = { name, contents: '123', cacheKey: `project:${name}:revision-1` };
  const renderer = new FileRenderer({ theme: 'github-light' });
  try {
    renderer.beginEditSession();
    await renderer.initializeHighlighter();
    renderer.renderFile(file);
    renderer.updateRenderCache(new Map<number, HighlightedToken[]>([
      [0, [[0, '', '123']]],
      [1, [[0, '', '456']]],
    ]), 'light', true);
    renderer.applyDocumentChange(new TextDocument(name, '123\n456'));
    const result = renderer.renderFile(file);
    expect(result?.totalLines).toBe(2);
    expect(renderer.renderPartialHTML(result!.contentAST)).toContain('456');
  } finally { renderer.cleanUp(); }
});

it('keeps the editable surface focused while typing and inserting a newline', async () => {
  // happy-dom has no canvas; the editor only needs deterministic character widths here.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    measureText: (text: string) => ({ width: text.length * 8 }),
  } as CanvasRenderingContext2D);
  let editor!: Editor<undefined>;
  let fileInstance!: Parameters<Editor<undefined>['edit']>[0];
  const edit = Editor.prototype.edit;
  vi.spyOn(Editor.prototype, 'edit').mockImplementation(function (this: Editor<undefined>, instance) {
    editor = this;
    fileInstance = instance;
    return edit.call(this, instance);
  });
  function Document() {
    const [content, setContent] = useState('123');
    const [revision, setRevision] = useState(1);
    return <EditableWorkspaceFile content={content} file={{ projectId: 'project', path: 'test123', revision: `r${revision}` }}
      onChange={setContent} onSave={async () => { setRevision((current) => current + 1); return true; }} />;
  }
  const view = render(<Document />);
  const getInput = () => view.container.querySelector('diffs-container')?.shadowRoot?.querySelector<HTMLElement>('[role="textbox"]');
  await waitFor(() => expect(getInput()).toBeTruthy());
  act(() => editor.focus({ lineNumber: 1 }));
  await waitFor(() => expect((getInput()?.getRootNode() as ShadowRoot)?.activeElement).toBe(getInput()));
  const input = getInput()!;
  for (const text of ['a', 'b', '\n', 'c']) {
    await act(async () => {
      fireEvent(input, new InputEvent('beforeinput', { bubbles: true, composed: true, cancelable: true,
        inputType: text === '\n' ? 'insertParagraph' : 'insertText', data: text === '\n' ? null : text }));
      // Layout/viewport refreshes must keep the live document and its focused content node.
      fileInstance.rerender();
    });
    await waitFor(() => expect(input.isConnected).toBe(true));
    expect((input.getRootNode() as ShadowRoot).activeElement).toBe(input);
  }
  expect(editor.getText()).toContain('ab\nc');
  const beforeSave = editor.getText();
  await act(async () => { fireEvent.keyDown(input, { key: 's', ctrlKey: true, composed: true }); });
  expect(getInput()).toBe(input);
  expect((input.getRootNode() as ShadowRoot).activeElement).toBe(input);
  expect(editor.getText()).toBe(beforeSave);
  expect(editor.canUndo).toBe(true);
  expect(editor.getState().selections).toHaveLength(1);
  await act(async () => {
    fireEvent(input, new CompositionEvent('compositionstart', { bubbles: true, composed: true }));
    // happy-dom's CompositionEvent omits data even when passed in the constructor.
    fireEvent(input, Object.assign(new CompositionEvent('compositionend', { bubbles: true, composed: true }), { data: '中文' }));
  });
  expect(editor.getText()).toContain('ab\nc中文');
  expect((input.getRootNode() as ShadowRoot).activeElement).toBe(input);
});
