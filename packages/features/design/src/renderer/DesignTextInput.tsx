import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';

export function DesignTextInput({ initialText, label, style, autoWidth = false, onCommit, onCancel }: Readonly<{
  initialText: string;
  label: string;
  style: CSSProperties;
  autoWidth?: boolean;
  onCommit(text: string): Promise<boolean>;
  onCancel(): void;
}>) {
  const [text, setText] = useState(initialText);
  const [pending, setPending] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const saving = useRef(false);
  const cancelled = useRef(false);

  useLayoutEffect(() => {
    input.current?.focus({ preventScroll: true });
    input.current?.select();
  }, []);

  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    if (autoWidth) {
      element.style.width = '1px';
      const width = typeof style.width === 'number' ? style.width : 1;
      element.style.width = `${Math.max(width, element.scrollWidth + 2)}px`;
    }
    element.style.height = '0px';
    element.style.height = `${element.scrollHeight}px`;
  }, [autoWidth, style.fontFamily, style.fontSize, style.fontStyle, style.fontWeight, style.letterSpacing, style.lineHeight, style.width, text]);

  const submit = async (value: string) => {
    if (saving.current || cancelled.current) return;
    saving.current = true;
    setPending(true);
    try {
      if (!await onCommit(value)) input.current?.focus({ preventScroll: true });
    } finally {
      saving.current = false;
      setPending(false);
    }
  };

  return <textarea
    ref={input}
    className="design-editor__text-input"
    aria-label={label}
    wrap={autoWidth ? 'off' : 'soft'}
    style={style}
    readOnly={pending}
    value={text}
    onChange={(event) => setText(event.target.value)}
    onBlur={(event) => { void submit(event.currentTarget.value); }}
    onKeyDown={(event) => {
      event.stopPropagation();
      if (event.nativeEvent.isComposing || event.keyCode === 229 || saving.current) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        cancelled.current = true;
        onCancel();
      } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        void submit(event.currentTarget.value);
      }
    }}
  />;
}
