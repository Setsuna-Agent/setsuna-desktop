import { Bold, RotateCcw, Type } from 'lucide-react';
import { useContext, useRef, useState } from 'react';
import { Button, IconButton, Popover, TextArea } from '@setsuna-desktop/renderer-ui';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { designDefaultColor } from '../../contracts/design-color.js';
import { rebaseDesignTextRuns, updateDesignTextRange, type DesignText, type DesignTextRun } from '../../contracts/index.js';
import { designFontStack } from '../design-text.js';
import { designInspectorPopoverPosition, NumberField } from '../inspector/DesignInspectorFields.js';
import { ColorField } from '../inspector/DesignPaintField.js';
import { designColorStyle, DesignStyleContext, DesignStyleSelect, type DesignStyleChoice } from '../styles/DesignStyleSelect.js';
import { DesignFontField } from './DesignFontField.js';
import { designTextSegments } from './design-rich-text.js';

type EditorProps = Readonly<{
  node: DesignText;
  disabled: boolean;
  onSave(text: string, runs: readonly DesignTextRun[]): Promise<boolean>;
  translate: RendererTranslate;
}>;
type RunStyle = Omit<DesignTextRun, 'start' | 'end'>;

export function DesignRichTextEditor({ node, disabled, onSave, translate: t }: EditorProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const saving = useRef(false);
  const label = t('feature.design.inlineTextStyles');
  return <Popover {...designInspectorPopoverPosition} open={open} hideWhenDetached contentLabel={label}
    className="design-form-popover design-rich-text-popover" onOpenChange={(next) => { if (!saving.current) setOpen(next); }}
    content={open ? <RichTextFields node={node} disabled={pending || disabled} pending={pending} translate={t}
      onClose={() => setOpen(false)} onSave={async (text, runs) => {
        if (saving.current || disabled) return;
        saving.current = true;
        setPending(true);
        try { if (await onSave(text, runs)) setOpen(false); }
        finally { saving.current = false; setPending(false); }
      }} /> : null}>
    <IconButton size="small" label={label} disabled={disabled || pending}><Type size={15} /></IconButton>
  </Popover>;
}

function RichTextFields({ node, disabled, pending, onSave, onClose, translate: t }: Omit<EditorProps, 'onSave'> & Readonly<{
  pending: boolean; onSave(text: string, runs: readonly DesignTextRun[]): Promise<void>; onClose(): void;
}>) {
  const { styles } = useContext(DesignStyleContext);
  const [text, setText] = useState(node.text);
  const [runs, setRuns] = useState<readonly DesignTextRun[]>(node.runs ?? []);
  const [range, setRange] = useState({ start: 0, end: 0 });
  const [draftStyle, setDraftStyle] = useState<{ style: RunStyle; owner?: string }>();
  const selected = range.end > range.start;
  const run = runs.find(({ start, end }) => start <= range.start && end > range.start);
  const source = designColorStyle(styles, run?.styleId);
  const sourceName = run?.styleId ? source?.name ?? t('feature.design.unavailableStyle') : undefined;
  const linkedRange = selected && runs.some(({ start, end, styleId }) => styleId && start < range.end && end > range.start);
  const fill = node.fills?.at(-1)?.color ?? designDefaultColor;
  const color = source?.color ?? run?.color ?? fill;
  const colorLink = ({ id, style }: DesignStyleChoice) => ({ styleId: id, color: style?.kind === 'color' ? style.color : color });
  const format = (style?: RunStyle) =>
    setRuns((current) => updateDesignTextRange(current, range.start, range.end, style));
  function previewFormat(style: RunStyle | undefined, owner?: string) {
    setDraftStyle((current) => style ? { style, owner } : current?.owner === owner ? undefined : current);
  }
  const preview = draftStyle ? updateDesignTextRange(runs, range.start, range.end, draftStyle.style) : runs;

  return <div className="design-popover-form">
    <TextArea aria-label={t('feature.design.text')} autoFocus value={text} rows={3} disabled={disabled}
      onSelect={(event) => setRange({ start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd })}
      onChange={(event) => {
        const after = event.currentTarget.value;
        setRuns((current) => rebaseDesignTextRuns(text, after, current) ?? []);
        setText(after);
        setRange({ start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd });
      }} />
    <div className="design-text-format-controls">
      <IconButton size="small" label={t('feature.design.inlineBold')} aria-pressed={run?.fontWeight === 700}
        disabled={!selected || disabled} onClick={() => format({ fontWeight: run?.fontWeight === 700 ? 400 : 700 })}><Bold size={15} /></IconButton>
      <IconButton size="small" label={t('feature.design.clearInlineStyle')} disabled={!selected || disabled}
        onClick={() => format()}><RotateCcw size={15} /></IconButton>
      <ColorField label={t('feature.design.fill')} value={color} displayName={sourceName} disabled={!selected || disabled || linkedRange}
        onPreview={(color) => previewFormat(color === undefined ? undefined : { color })}
        onSave={async (color) => { format({ color }); return true; }} />
      <DesignStyleSelect kind="color" value={run?.styleId} disabled={!selected || disabled} translate={t}
        onPreview={(choice, owner) => previewFormat(choice && colorLink(choice), owner)}
        onChange={(choice) => format(colorLink(choice))} />
    </div>
    <div className="design-text-font-controls">
      <DesignFontField value={run?.fontFamily ?? node.fontFamily} disabled={!selected || disabled} translate={t}
        onPreview={(fontFamily, owner) => previewFormat(fontFamily === undefined ? undefined : { fontFamily: fontFamily || undefined }, owner)}
        onSave={async (fontFamily) => { format({ fontFamily }); return true; }} />
      <NumberField label={t('feature.design.fontSize')} value={run?.fontSize ?? node.fontSize} readOnly={!selected || disabled} min={1}
        onSave={async (fontSize) => { format({ fontSize }); return true; }} />
    </div>
    <div className="design-text-format-preview" style={{ fontFamily: designFontStack(node.fontFamily), fontSize: node.fontSize,
      fontWeight: node.fontWeight, fontStyle: node.fontStyle, lineHeight: node.lineHeight ?? 1.2,
      letterSpacing: node.letterSpacing, textAlign: node.textAlign,
      color: fill }}>
      {designTextSegments(text, preview).map(({ text, run }, index) => <span key={index}
        style={{ color: designColorStyle(styles, run?.styleId)?.color ?? run?.color, fontWeight: run?.fontWeight, fontSize: run?.fontSize,
          fontFamily: run?.fontFamily ? designFontStack(run.fontFamily) : undefined }}>{text}</span>)}
    </div>
    <div className="design-popover-form__actions">
      <Button size="small" disabled={pending} onClick={onClose}>{t('feature.design.cancel')}</Button>
      <Button size="small" variant="primary" disabled={disabled} loading={pending} onClick={() => { void onSave(text, runs); }}>
        {t('feature.design.save')}
      </Button>
    </div>
  </div>;
}
