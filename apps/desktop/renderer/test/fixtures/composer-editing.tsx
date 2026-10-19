import { createRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ChatPromptInput } from '../../src/features/chat/composer/editor/ChatPromptInput.js';
import type { ComposerEditor } from '../../src/features/chat/composer/editor/types.js';
import { CHAT_COMPOSER_CLIPBOARD_TYPE } from '../../src/features/chat/composer/chatComposerClipboard.js';
import { useChatComposerClipboard } from '../../src/features/chat/composer/useChatComposerClipboard.js';

const editor = createRef<ComposerEditor>();
function Fixture() {
  const [draft, setDraft] = useState('');
  const clipboard = useChatComposerClipboard({ getEditor: () => editor.current, skills: [], onSkillsRestored: () => undefined });
  return <div {...clipboard}><ChatPromptInput ref={editor} value={draft} onChange={setDraft} /></div>;
}

const settle = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function runComposerEditingChecks() {
  flushSync(() => createRoot(document.getElementById('root')!).render(<Fixture />));
  const input = editor.current!.inputElement!;
  const surrounding = document.getElementById('surrounding')!;
  surrounding.scrollTop = 300;
  const surroundingTop = surrounding.scrollTop;
  const value = () => editor.current!.getValue().value;
  const suffix = () => {
    const range = document.getSelection()!.getRangeAt(0).cloneRange();
    range.setEnd(input, input.childNodes.length);
    return range.toString();
  };
  const reset = async (text = '') => {
    editor.current!.clear();
    if (text) editor.current!.insert([{ type: 'text', value: text }]);
    editor.current!.focus({ cursor: 'end', preventScroll: true });
    await settle();
    input.scrollTop = 0;
  };
  const placeCaret = (offset: number) => {
    const range = document.createRange();
    range.setStart(input.firstChild!, offset);
    range.collapse(true);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(range);
  };
  const paste = (text: string, structured = '') => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', text);
    if (structured) clipboardData.setData(CHAT_COMPOSER_CLIPBOARD_TYPE, structured);
    input.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }));
  };
  const newline = () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true }));
  const checkEnd = (description: string) => {
    check(document.activeElement === input && suffix() === '', `${description}: caret did not reach the insertion end`);
    check(input.scrollTop > 0 && Math.abs(input.scrollHeight - input.clientHeight - input.scrollTop) <= 1,
      `${description}: editor did not follow its end caret (scrollTop=${input.scrollTop})`);
    check(surrounding.scrollTop === surroundingTop, `${description}: moved the surrounding conversation`);
  };

  const longText = Array.from({ length: 30 }, (_, index) => `Line ${index}`).join('\n') + '\n';
  for (const text of [longText, longText.replaceAll('\n', '\r\n')]) {
    await reset();
    paste(text);
    // Parent focus requests may leave the selection on the editor element itself.
    editor.current!.focus({ cursor: 'end', preventScroll: true });
    await settle();
    check(value() === longText, 'Paste changed the normalized plain text');
    checkEnd('Multiline paste');
    input.scrollTop = 0;
    newline();
    await settle();
    check(value() === `${longText}\n`, 'Shift+Enter changed existing text');
    checkEnd('Trailing newline');
  }

  await reset();
  for (let index = 0; index < 20; index++) newline();
  await settle();
  check(value() === '\n'.repeat(20), 'Consecutive newlines were lost');
  checkEnd('Empty lines');

  const prefix = longText;
  const remaining = `\n\nAFTER\n${longText}`;
  await reset(prefix + remaining);
  placeCaret(prefix.length);
  newline();
  await settle();
  check(value() === `${prefix}\n${remaining}` && suffix() === remaining, 'Middle newline moved the insertion point');
  check(input.scrollTop > 0 && input.scrollTop < input.scrollHeight - input.clientHeight,
    'Middle blank-line caret did not scroll into the draft');

  await reset('before after');
  placeCaret(7);
  paste('middle\n');
  await settle();
  check(value() === 'before middle\nafter' && suffix() === 'after', 'Middle paste moved the insertion point');
  check(document.execCommand('undo') && value() === 'before after', 'Native undo failed');
  check(document.execCommand('redo') && value() === 'before middle\nafter', 'Native redo failed');

  await reset();
  paste(longText, JSON.stringify({ version: 1, parts: [
    { type: 'text', value: longText },
    { type: 'workspace', entry: { kind: 'file', path: 'src/main.ts', name: 'main.ts', parent: 'src' } },
  ] }));
  await settle();
  checkEnd('Structured paste');
  check(document.execCommand('insertText', false, 'TAIL'), 'Could not type after pasted reference');
  check(value() === `${longText}@src/main.tsTAIL`, 'Typing entered the reference instead of following it');
  check(editor.current!.getValue().slotConfig.filter((slot) => slot.type === 'tag').length === 1, 'Reference identity was lost');

  newline();
  document.getElementById('other-focus')!.focus({ preventScroll: true });
  await settle();
  check(document.activeElement?.id === 'other-focus', 'Deferred scrolling stole focus');
  check(surrounding.scrollTop === surroundingTop, 'Editing moved the surrounding conversation');
  return 'COMPOSER_NATIVE_EDITING_OK';
}

Object.assign(window, { runComposerEditingChecks });
