// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import type { PullRequestCommentInputProps } from '@setsuna-desktop/feature-pull-requests/renderer';
import { PullRequestCommentInput } from '../../../src/composition/PullRequestCommentInput.js';

afterEach(cleanup);
const inputProps = (): PullRequestCommentInputProps => ({
  value: 'Original draft', label: 'Comment', placeholder: 'Write a comment', disabled: false,
  maxLength: 65_000, footer: null, onChange: vi.fn(), onSubmit: vi.fn(),
});

it('restores locked drafts, applies external quotes and clears published text without emitting user edits', () => {
  const props = inputProps();
  const view = render(<PullRequestCommentInput {...props} disabled />);
  const input = screen.getByRole('textbox', { name: 'Comment' });
  expect(input.textContent).toBe('Original draft');
  fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
  expect(props.onChange).not.toHaveBeenCalled();
  expect(props.onSubmit).not.toHaveBeenCalled();

  view.rerender(<PullRequestCommentInput {...props} value="Original draft + quoted comment" focusRequest={1} />);
  expect(input.textContent).toBe('Original draft + quoted comment');
  expect(props.onChange).not.toHaveBeenCalled();
  input.textContent = 'Edited comment';
  fireEvent.input(input);
  expect(props.onChange).toHaveBeenCalledExactlyOnceWith('Edited comment');
  view.rerender(<PullRequestCommentInput {...props} value="Edited comment" />);
  view.rerender(<PullRequestCommentInput {...props} value="" />);
  expect(input.textContent).toBe('');
  expect(props.onChange).toHaveBeenCalledTimes(1);
});

it('enforces the comment limit in both the editor and the saved draft', () => {
  const changed = vi.fn();
  function ControlledInput() {
    const [value, setValue] = useState('');
    return <PullRequestCommentInput {...inputProps()} value={value} maxLength={10} onChange={(next) => { changed(next); setValue(next); }} />;
  }
  render(<ControlledInput />);
  const input = screen.getByRole('textbox', { name: 'Comment' });
  input.textContent = '1234567890more';
  fireEvent.input(input);
  expect(input.textContent).toBe('1234567890');
  expect(changed).toHaveBeenCalledExactlyOnceWith('1234567890');
});

it.each([
  [8, 8], [2, 6], [6, 2],
])('preserves the visible caret or selection while synchronizing the hidden reply (%i → %i)', (anchorOffset, focusOffset) => {
  const changed = vi.fn();
  function SharedReply() {
    const [value, setValue] = useState('Original draft');
    const onChange = (next: string) => { changed(next); setValue(next); };
    return <>
      <PullRequestCommentInput {...inputProps()} value={value} onChange={onChange} />
      <div hidden><PullRequestCommentInput {...inputProps()} label="Hidden reply" value={value} onChange={onChange} /></div>
    </>;
  }
  const view = render(<SharedReply />);
  const input = screen.getByRole('textbox', { name: 'Comment' });
  const hidden = view.container.querySelector('[aria-label="Hidden reply"]')!;
  const selection = document.getSelection()!;
  // Exercise both the append and replacement paths in shared draft synchronization.
  for (const value of ['Original draft extended', 'Revised draft']) {
    input.textContent = value;
    const text = input.firstChild!;
    act(() => { input.focus(); selection.setBaseAndExtent(text, anchorOffset, text, focusOffset); });
    fireEvent.input(input);
    expect(document.activeElement).toBe(input);
    expect(selection.anchorNode).toBe(text);
    expect(selection.focusNode).toBe(text);
    expect([selection.anchorOffset, selection.focusOffset]).toEqual([anchorOffset, focusOffset]);
    expect(hidden.textContent).toBe(value);
    const expected = `${value.slice(0, Math.min(anchorOffset, focusOffset))}X${value.slice(Math.max(anchorOffset, focusOffset))}`;
    fireEvent.paste(input, { clipboardData: { files: [], getData: () => 'X' } });
    expect(input.textContent).toBe(expected);
    expect(hidden.textContent).toBe(expected);
    expect(changed).toHaveBeenLastCalledWith(expected);
  }
  expect(changed).toHaveBeenCalledTimes(4);
});
