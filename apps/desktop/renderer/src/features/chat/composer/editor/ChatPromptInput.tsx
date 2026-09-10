// Prompt surface adapted from beUI (MIT): https://beui.dev/components/agents/prompt-input
import { Button } from '@setsuna-desktop/renderer-ui';
import { ArrowUp, Square } from 'lucide-react';
import { createPortal } from 'react-dom';
import { forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react';
import { useI18n } from '../../../../shared/i18n/I18nProvider.js';
import { applyComposerRange, composerFragment, composerRange, extendCommandRange, readComposerDocument, slotText } from './composerDocument.js';
import type { ComposerEditor, ComposerSlot } from './types.js';

type Props = Omit<HTMLAttributes<HTMLDivElement>, 'onChange' | 'onSubmit'> & {
  value?: string; slotConfig?: ComposerSlot[]; disabled?: boolean; loading?: boolean; placeholder?: string;
  autoSize?: { minRows: number; maxRows: number };
  header?: ReactNode; footer?: (actions: ReactNode) => ReactNode;
  onChange?(value: string, event?: unknown, slots?: ComposerSlot[]): void;
  onPasteFile?(files: FileList): void;
  onSubmit?(value: string): unknown;
  onCancel?(): void;
};
type TagPortal = { element: HTMLElement; slot: Extract<ComposerSlot, { type: 'tag' }> };

export const ChatPromptInput = forwardRef<ComposerEditor, Props>(function ChatPromptInput({ value = '', slotConfig, disabled, loading, placeholder, autoSize = { minRows: 2, maxRows: 6 }, header, footer, onChange, onSubmit, onCancel, onPasteFile, onKeyDown, ...props }, ref) {
  const { t } = useI18n();
  const elementRef = useRef<HTMLDivElement | null>(null);
  const references = useRef(new Map<string, ComposerSlot>());
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const initial = useRef(slotConfig ?? [{ type: 'text' as const, value }]);
  const [portals, setPortals] = useState<TagPortal[]>([]);
  const [empty, setEmpty] = useState(!value.trim());
  const initialized = useRef(false);
  const portalTargets = useRef(new WeakSet<HTMLElement>());
  const composing = useRef(false);

  const synchronize = useCallback(() => {
    const element = elementRef.current;
    if (!element) return;
    const slots = readComposerDocument(element, references.current);
    const text = slots.map(slotText).join('');
    setEmpty(!text.trim());
    const targets = [...element.querySelectorAll<HTMLElement>('[data-slot-key]')].flatMap((target): TagPortal[] => {
      const slot = references.current.get(target.dataset.slotKey ?? '');
      return slot?.type === 'tag' ? [{ element: target, slot }] : [];
    });
    // Clear each new DOM label once, outside React's replayable state updater.
    for (const target of targets) {
      if (!portalTargets.current.has(target.element)) {
        target.element.replaceChildren();
        portalTargets.current.add(target.element);
      }
    }
    setPortals((current) => {
      if (current.length === targets.length && current.every((item, index) => item.element === targets[index].element)) return current;
      return targets;
    });
    onChangeRef.current?.(text, undefined, slots);
  }, []);

  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element || initialized.current) return;
    initialized.current = true;
    element.append(composerFragment(element.ownerDocument, initial.current, references.current));
    synchronize();
  }, [synchronize]);

  const insert = useCallback<ComposerEditor['insert']>((slots, position = 'cursor', replaceCharacters, preventScroll = true) => {
    const element = elementRef.current;
    if (!element) return;
    const range = composerRange(element, position);
    if (replaceCharacters) extendCommandRange(range, element, replaceCharacters);
    element.focus({ preventScroll });
    applyComposerRange(range);
    const fragment = composerFragment(element.ownerDocument, slots, references.current);
    // Use the browser editing transaction so normal undo/redo includes inserted tags.
    const wrapper = element.ownerDocument.createElement('div');
    wrapper.append(fragment);
    const edited = element.ownerDocument.execCommand?.('insertHTML', false, wrapper.innerHTML);
    if (!edited) {
      const content = element.ownerDocument.createDocumentFragment();
      content.append(...wrapper.childNodes);
      const tail = content.lastChild;
      range.deleteContents(); range.insertNode(content);
      if (tail) { range.setStartAfter(tail); range.collapse(true); applyComposerRange(range); }
    }
    synchronize();
  }, [synchronize]);

  useImperativeHandle(ref, () => ({
    get inputElement() { return elementRef.current; },
    getValue() {
      const slots = elementRef.current ? readComposerDocument(elementRef.current, references.current) : [];
      return { value: slots.map(slotText).join(''), slotConfig: slots };
    },
    focus(options) {
      const element = elementRef.current;
      if (!element) return;
      element.focus({ preventScroll: options?.preventScroll });
      if (!options?.cursor) return;
      const range = composerRange(element, options.cursor === 'start' ? 'start' : 'end');
      if (options.cursor === 'all') range.selectNodeContents(element);
      applyComposerRange(range);
    },
    clear() { elementRef.current?.replaceChildren(); synchronize(); },
    insert,
  }), [insert, synchronize]);

  const actions = <Button className="chat-prompt__submit" variant="primary" disabled={disabled || (!loading && empty)} aria-label={loading ? t('chat.composer.stop') : t('chat.composer.send')}
    onClick={() => loading ? onCancel?.() : onSubmit?.(elementRef.current ? readComposerDocument(elementRef.current, references.current).map(slotText).join('') : value)}>
    {loading ? <Square size={13} fill="currentColor" /> : <ArrowUp size={16} />}
  </Button>;
  return <div className="chat-prompt" data-disabled={disabled || undefined}>
    {header}
    <div {...props} ref={elementRef} className="chat-prompt__input" contentEditable={!disabled} suppressContentEditableWarning role="textbox" aria-multiline="true" aria-label={placeholder} aria-disabled={disabled}
      data-placeholder={placeholder} data-empty={empty || undefined} style={{ '--prompt-min-rows': autoSize.minRows, '--prompt-max-rows': autoSize.maxRows } as CSSProperties}
      onInput={synchronize} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; synchronize(); }}
      onPaste={(event) => {
        if (event.defaultPrevented) return;
        if (event.clipboardData.files.length) { event.preventDefault(); onPasteFile?.(event.clipboardData.files); return; }
        event.preventDefault(); insert([{ type: 'text', value: event.clipboardData.getData('text/plain') }]);
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented || composing.current || event.nativeEvent.isComposing || event.key !== 'Enter') return;
        if (event.shiftKey) { event.preventDefault(); insert([{ type: 'text', value: '\n' }]); return; }
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        event.preventDefault();
        if (!disabled && !loading && !empty) onSubmit?.(readComposerDocument(event.currentTarget, references.current).map(slotText).join(''));
      }} />
    {portals.map(({ element, slot }) => createPortal(slot.props.label ?? slot.props.value, element, slot.key))}
    <div className="chat-prompt__footer">{footer ? footer(actions) : actions}</div>
  </div>;
});
