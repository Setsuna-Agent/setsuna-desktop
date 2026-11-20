// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { useCallback, useRef } from 'react';
import { afterEach, expect, it } from 'vitest';
import { parseDesignSelectionMentions, type DesignSelectionReference } from '@setsuna-desktop/feature-design/contracts/design-selection-mention';
import type { DesignChatBinding } from '@setsuna-desktop/feature-design/renderer';
import { ChatPromptInput } from '../../../../../src/features/chat/composer/editor/ChatPromptInput.js';
import type { ComposerEditor } from '../../../../../src/features/chat/composer/editor/types.js';
import { DesignSelectionProvider, useDesignSelectionInsertion } from '../../../../../src/features/chat/mentions/DesignSelectionReference.js';

afterEach(cleanup);

it('updates only a trailing pick, appends after text, and inserts at the captured caret while composing', () => {
  let beginPick: Parameters<NonNullable<DesignChatBinding['subscribePicks']>>[0] | undefined;
  let value = '';
  function Composer() {
    const ref = useRef<ComposerEditor>(null);
    useDesignSelectionInsertion(useCallback(() => ref.current, []), false);
    return <ChatPromptInput ref={ref} value="Old draft" onChange={(next) => { value = next; }} />;
  }
  const ui = render(<DesignSelectionProvider value={{ documentId: 'design', subscribePicks(begin) {
    beginPick = begin; return () => { beginPick = undefined; };
  } }}><Composer /><button>Canvas</button></DesignSelectionProvider>);
  const input = ui.getByRole('textbox');
  const canvas = ui.getByRole('button', { name: 'Canvas' });
  const pick = (id: string) => {
    const reference: DesignSelectionReference = { documentId: 'design', boards: ['board'], ids: [id], label: id };
    act(() => {
      const finish = beginPick!();
      canvas.focus();
      finish!(reference);
    });
  };
  // Model the editable DOM Chromium leaves behind after the final character is deleted.
  input.innerHTML = '<div><br></div>';
  fireEvent.input(input);
  expect(value).toBe('');
  canvas.focus();
  pick('A');
  pick('B');
  const refs = () => parseDesignSelectionMentions(value);
  expect(refs().map(({ reference }) => reference.ids)).toEqual([['B']]);
  expect(refs()[0].start).toBe(0);
  expect(value).not.toContain('\n');
  expect(document.activeElement).toBe(canvas);

  input.focus();
  const body = document.createTextNode('keep this');
  input.append(body);
  fireEvent.input(input);
  const caret = document.createRange();
  caret.setStart(body, 5);
  caret.collapse(true);
  const selection = document.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(caret);
  pick('C');
  expect(document.activeElement).toBe(input);
  pick('D');
  expect(refs().map(({ reference }) => reference.ids)).toEqual([['B'], ['C'], ['D']]);
  expect(value.slice(refs()[0].end, refs()[1].start)).toBe(' keep ');
  expect(value.slice(refs()[2].end)).toBe(' this');

  canvas.focus();
  pick('E');
  expect(refs().map(({ reference }) => reference.ids)).toEqual([['B'], ['C'], ['D'], ['E']]);
  expect(value.slice(refs()[2].end, refs()[3].start)).toBe(' this ');
  const beforeTrailingPick = value.slice(0, refs()[3].start);
  pick('F');
  expect(refs().map(({ reference }) => reference.ids)).toEqual([['B'], ['C'], ['D'], ['F']]);
  expect(value.slice(0, refs()[3].start)).toBe(beforeTrailingPick);
  expect(document.activeElement).toBe(canvas);
  act(() => beginPick!(true)!(null));
  expect(refs().map(({ reference }) => reference.ids)).toEqual([['B'], ['C'], ['D']]);
  expect(value).toContain(' this');
  input.replaceChildren();
  fireEvent.input(input);
  pick('A');
  act(() => beginPick!(true)!(null));
  expect(value).toBe('');
});
