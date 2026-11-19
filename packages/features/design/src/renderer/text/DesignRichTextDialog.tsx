import { Bold, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { Button, Dialog, IconButton, TextArea } from '@setsuna-desktop/renderer-ui';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { designTextFill, rebaseDesignTextRuns, updateDesignTextRange, type DesignText, type DesignTextRun } from '../../contracts/index.js';
import { designFontStack } from '../design-text.js';
import { NumberField, PaintField } from '../inspector/DesignInspectorFields.js';
import { DesignStyleSelect } from '../styles/DesignStyleSelect.js';
import { DesignFontField } from './DesignFontField.js';
import { designTextSegments } from './design-rich-text.js';

export function DesignRichTextDialog({ node, onSave, onClose, translate: t }: Readonly<{
  node: DesignText; onSave(text: string, runs: readonly DesignTextRun[]): Promise<boolean>; onClose(): void; translate: RendererTranslate;
}>) {
  const [text, setText] = useState(node.text);
  const [runs, setRuns] = useState<readonly DesignTextRun[]>(node.runs ?? []);
  const [range, setRange] = useState({ start: 0, end: 0 });
  const [previewColor, setPreviewColor] = useState<string>();
  const [pending, setPending] = useState(false);
  const selected = range.end > range.start;
  const run = runs.find(({ start, end }) => start <= range.start && end > range.start);
  const color = run?.color ?? node.fills?.at(-1)?.color ?? designTextFill;
  const format = (style?: Omit<DesignTextRun, 'start' | 'end'>) =>
    setRuns((current) => updateDesignTextRange(current, range.start, range.end, style));
  const preview = previewColor ? updateDesignTextRange(runs, range.start, range.end, { color: previewColor }) : runs;

  return <Dialog title={t('feature.design.inlineTextStyles')} width={500} dismissible={!pending} onClose={onClose} footer={<>
    <Button variant="ghost" disabled={pending} onClick={onClose}>{t('feature.design.cancel')}</Button>
    <Button loading={pending} onClick={() => {
      setPending(true);
      void onSave(text, runs).then((ok) => { if (ok) onClose(); }).finally(() => setPending(false));
    }}>{t('feature.design.save')}</Button>
  </>}>
    <TextArea aria-label={t('feature.design.text')} autoFocus value={text} rows={4} disabled={pending}
      onSelect={(event) => setRange({ start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd })}
      onChange={(event) => {
        const after = event.currentTarget.value;
        setRuns((current) => rebaseDesignTextRuns(text, after, current) ?? []);
        setText(after);
        setRange({ start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd });
      }} />
    <div className="design-text-format-controls">
      <IconButton size="small" label={t('feature.design.inlineBold')} aria-pressed={run?.fontWeight === 700}
        disabled={!selected || pending} onClick={() => format({ fontWeight: run?.fontWeight === 700 ? 400 : 700 })}><Bold size={15} /></IconButton>
      <IconButton size="small" label={t('feature.design.clearInlineStyle')} disabled={!selected || pending}
        onClick={() => format()}><RotateCcw size={15} /></IconButton>
      <PaintField label={t('feature.design.fill')} value={color} disabled={!selected || pending}
        onPreview={setPreviewColor} onSave={async (color) => { format({ color, styleId: undefined }); return true; }} />
      <DesignStyleSelect kind="color" value={run?.styleId} disabled={!selected || pending} translate={t}
        onChange={(styleId, style) => format({ styleId, color: style?.kind === 'color' ? style.color : color })} />
    </div>
    <div className="design-text-font-controls">
      <DesignFontField value={run?.fontFamily ?? node.fontFamily} disabled={!selected || pending} translate={t}
        onSave={async (fontFamily) => { format({ fontFamily }); return true; }} />
      <NumberField label={t('feature.design.fontSize')} value={run?.fontSize ?? node.fontSize} readOnly={!selected || pending} min={1}
        onSave={async (fontSize) => { format({ fontSize }); return true; }} />
    </div>
    <div className="design-text-format-preview" style={{ fontFamily: designFontStack(node.fontFamily), fontSize: node.fontSize,
      fontWeight: node.fontWeight, lineHeight: node.lineHeight ?? 1.2, letterSpacing: node.letterSpacing, textAlign: node.textAlign,
      color: node.fills?.at(-1)?.color ?? designTextFill }}>
      {designTextSegments(text, preview).map(({ text, run }, index) => <span key={index}
        style={{ color: run?.color, fontWeight: run?.fontWeight, fontSize: run?.fontSize,
          fontFamily: run?.fontFamily ? designFontStack(run.fontFamily) : undefined }}>{text}</span>)}
    </div>
  </Dialog>;
}
