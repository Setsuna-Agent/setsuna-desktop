import { AlignCenter, AlignJustify, AlignLeft, AlignRight, Type } from 'lucide-react';
import { useState, type ComponentProps } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { IconButton, SelectField } from '@setsuna-desktop/renderer-ui';
import { designFontWeights, designTextAlignments, designTypographyOf, type DesignNode, type DesignText, type DesignTypography } from '../../contracts/index.js';
import { designTextStyle } from '../design-text.js';
import { DesignStyleSelect } from '../styles/DesignStyleSelect.js';
import { DesignFontField } from '../text/DesignFontField.js';
import { DesignRichTextDialog } from '../text/DesignRichTextDialog.js';
import { InspectorSection, NumberField } from './DesignInspectorFields.js';
import { bindDesignNumber, type InspectorNumberEdits } from './design-inspector-edit.js';

const textAlignmentIcons = { left: AlignLeft, center: AlignCenter, right: AlignRight, justify: AlignJustify };
type NumericTypography = 'fontSize' | 'lineHeight' | 'letterSpacing';

export function DesignTypographyFields({ typography, disabled, onSave, numbers, translate: t }: Readonly<{
  typography: DesignTypography; disabled: boolean; onSave(patch: Partial<DesignTypography>): Promise<boolean>;
  numbers?: (key: NumericTypography) => Pick<ComponentProps<typeof NumberField>, 'onSave' | 'onPreview'>;
  translate: RendererTranslate;
}>) {
  const style = designTextStyle(typography);
  const number = (key: NumericTypography) => numbers?.(key) ?? { onSave: (value: number) => onSave({ [key]: value }) };
  const weightLabel = t('feature.design.fontWeight');
  return <>
    <DesignFontField value={typography.fontFamily} disabled={disabled} onSave={(fontFamily) => onSave({ fontFamily })} translate={t} />
    <div className="design-inspector__pair">
      <NumberField label={t('feature.design.fontSize')} value={style.fontSize} min={1} readOnly={disabled} {...number('fontSize')} />
      <SelectField aria-label={weightLabel} title={weightLabel} value={String(style.fontWeight)} disabled={disabled}
        onValueChange={(value) => {
          const fontWeight = designFontWeights.find((item) => String(item) === value);
          if (fontWeight !== undefined) void onSave({ fontWeight });
        }}>
        {designFontWeights.map((weight) => <option key={weight} value={String(weight)}>{t(`feature.design.weight.${weight}`)}</option>)}
      </SelectField>
    </div>
    <div className="design-inspector__pair">
      <NumberField label={t('feature.design.lineHeight')} prefix={t('feature.design.lineHeight')} suffix="×" value={style.lineHeight}
        min={0.01} readOnly={disabled} {...number('lineHeight')} />
      <NumberField label={t('feature.design.letterSpacing')} value={style.letterSpacing} readOnly={disabled} {...number('letterSpacing')} />
    </div>
    <div className="design-inspector__alignment" role="group" aria-label={t('feature.design.textAlignment')}>
      {designTextAlignments.map((align) => {
        const Icon = textAlignmentIcons[align];
        return <IconButton key={align} label={t(`feature.design.textAlign.${align}`)} size="small" disabled={disabled}
          aria-pressed={style.textAlign === align} onClick={() => {
            if (style.textAlign !== align) void onSave({ textAlign: align });
          }}><Icon size={14} /></IconButton>;
      })}
    </div>
  </>;
}

export function DesignTextFields({ node, projected, disabled, onSave, numberEdits, translate: t }: Readonly<{
  node: DesignText; projected: DesignText; disabled: boolean; onSave(node: DesignNode): Promise<boolean>;
  numberEdits: InspectorNumberEdits; translate: RendererTranslate;
}>) {
  const [formatting, setFormatting] = useState(false);
  function update(current: DesignNode, patch: Partial<DesignTypography>) {
    return current.kind === 'text' ? { ...current, ...designTypographyOf(current.textStyleId ? projected : current), ...patch, textStyleId: undefined } : current;
  }
  return <InspectorSection title={t('feature.design.text')} action={<IconButton size="small" label={t('feature.design.inlineTextStyles')}
    disabled={disabled} onClick={() => setFormatting(true)}><Type size={15} /></IconButton>}>
    <DesignStyleSelect kind="text" value={node.textStyleId} disabled={disabled} translate={t}
      onChange={(textStyleId, style) => {
        void onSave({ ...node, ...(style?.kind === 'text' ? style.typography : designTypographyOf(projected)), textStyleId });
      }} />
    <DesignTypographyFields typography={projected} disabled={disabled} translate={t}
      onSave={(patch) => onSave(update(node, patch))}
      numbers={(key) => bindDesignNumber(numberEdits, (current, value) => update(current, { [key]: value }))} />
    {formatting ? <DesignRichTextDialog node={projected} onClose={() => setFormatting(false)} translate={t}
      onSave={(text, runs) => onSave({ ...node, text, runs })} /> : null}
  </InspectorSection>;
}
