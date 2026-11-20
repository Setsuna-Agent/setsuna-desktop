import { AlignCenter, AlignJustify, AlignLeft, AlignRight } from 'lucide-react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { IconButton, SelectField } from '@setsuna-desktop/renderer-ui';
import { designTextAlignments, designTypographyOf, rebaseDesignTextRuns,
  type DesignNode, type DesignText, type DesignTypography } from '../../contracts/index.js';
import { designFontStyles, designFontWeights, isDesignFontWeight, type DesignFontStyle, type DesignFontWeight } from '../../contracts/design-fonts.js';
import { designTypographyVariableFields } from '../../contracts/design-variables.js';
import { designTextStyle } from '../design-text.js';
import { DesignStyleSelect, type DesignStyleChoice } from '../styles/DesignStyleSelect.js';
import { DesignVariableField, VariableNumberField } from '../styles/DesignVariableField.js';
import { DesignFontField } from '../text/DesignFontField.js';
import { DesignRichTextEditor } from '../text/DesignRichTextEditor.js';
import { InspectorSection } from './DesignInspectorFields.js';
import { bindDesignValue, type InspectorFieldEdits } from './design-inspector-edit.js';

const textAlignmentIcons = { left: AlignLeft, center: AlignCenter, right: AlignRight, justify: AlignJustify };
const fontVariants = designFontStyles.flatMap((fontStyle) => designFontWeights.map((fontWeight) =>
  ({ fontStyle, fontWeight, id: `${fontStyle}:${fontWeight}` })));
type NumericTypography = 'fontSize' | 'lineHeight' | 'letterSpacing';
type TypographyEdits = Readonly<{
  onSave(patch: Partial<DesignTypography>): Promise<boolean>;
  onPreview(patch: Partial<DesignTypography> | undefined, owner: string): void;
}>;

export function DesignTypographyFields({ typography, target = typography, disabled, onSave, onBind, onBindPreview, onPreview, translate: t }: TypographyEdits & Readonly<{
  typography: DesignTypography; disabled: boolean;
  target?: DesignTypography; onBind(typography: DesignTypography): Promise<boolean>;
  onBindPreview(typography: DesignTypography | undefined, owner: string): void;
  translate: RendererTranslate;
}>) {
  const style = designTextStyle(typography);
  const number = (key: NumericTypography) => ({
    onSave: (value: number) => onSave({ [key]: value }),
    onPreview: (value: number | undefined, owner: string) => onPreview(value === undefined ? undefined : { [key]: value }, owner),
  });
  const weightLabel = t('feature.design.fontWeight');
  const lineHeightLabel = t('feature.design.lineHeight');
  const binding = { target, disabled, onBind, onBindPreview, translate: t };
  return <>
    <DesignVariableField {...binding} field="fontFamily" label={t('feature.design.fontFamily')}>
      {(value, linked) => <DesignFontField value={typeof value === 'string' ? value : typography.fontFamily} disabled={disabled || linked}
        onPreview={(fontFamily, owner) => onPreview(fontFamily === undefined ? undefined : { fontFamily: fontFamily || undefined }, owner)}
        onSave={(fontFamily) => onSave({ fontFamily })} translate={t} />}
    </DesignVariableField>
    <div className="design-inspector__pair">
      <VariableNumberField {...binding} field="fontSize" label={t('feature.design.fontSize')} value={style.fontSize}
        min={1} readOnly={disabled} {...number('fontSize')} />
      <DesignVariableField {...binding} field="fontWeight" label={weightLabel}>
        {(value, linked) => <FontStyleField fontWeight={isDesignFontWeight(value) ? value : style.fontWeight} fontStyle={style.fontStyle}
          weightLinked={linked} disabled={disabled} onSave={onSave} onPreview={onPreview} translate={t} />}
      </DesignVariableField>
    </div>
    <div className="design-inspector__pair">
      <VariableNumberField {...binding} field="lineHeight" label={lineHeightLabel} prefix={lineHeightLabel} suffix="×"
        value={style.lineHeight} min={0.01} readOnly={disabled} {...number('lineHeight')} />
      <VariableNumberField {...binding} field="letterSpacing" label={t('feature.design.letterSpacing')}
        value={style.letterSpacing} readOnly={disabled} {...number('letterSpacing')} />
    </div>
    <div className="design-inspector__segments" role="group" aria-label={t('feature.design.textAlignment')}>
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

function FontStyleField({ fontWeight, fontStyle, weightLinked, disabled, onSave, onPreview, translate: t }: TypographyEdits & Readonly<{
  fontWeight: DesignFontWeight;
  fontStyle: DesignFontStyle;
  weightLinked: boolean;
  disabled: boolean;
  translate: RendererTranslate;
}>) {
  const label = t('feature.design.fontStyle');
  const italic = t('feature.design.fontItalic');
  const choices = weightLinked ? fontVariants.filter((face) => face.fontWeight === fontWeight) : fontVariants;
  function patchFor(id: string | undefined): Partial<DesignTypography> | undefined {
    const face = choices.find((option) => option.id === id);
    if (!face) return;
    const fontStyle = face.fontStyle === 'italic' ? 'italic' : undefined;
    // Choosing the slant preserves any font weight supplied by a variable.
    return weightLinked ? { fontStyle } : { fontStyle, fontWeight: face.fontWeight };
  }
  return <SelectField aria-label={label} title={label} value={`${fontStyle}:${fontWeight}`} disabled={disabled}
    onValuePreview={(value, owner) => onPreview(patchFor(value), owner)}
    onValueChange={(value) => {
      const patch = patchFor(value);
      if (patch) void onSave(patch);
    }}>
    {designFontStyles.map((style) => <optgroup key={style} label={style === 'italic' ? italic : t('feature.design.fontUpright')}>
      {choices.filter((face) => face.fontStyle === style).map(({ id, fontWeight }) => {
        const weight = t(`feature.design.weight.${fontWeight}`);
        return <option key={id} value={id}>{style === 'normal' ? weight
          : fontWeight === 400 ? italic : t('feature.design.weightItalic', { weight })}</option>;
      })}
    </optgroup>)}
  </SelectField>;
}

export function DesignTextFields({ node, projected, disabled, onSave, fieldEdits, translate: t }: Readonly<{
  node: DesignText; projected: DesignText; disabled: boolean; onSave(node: DesignNode): Promise<boolean>;
  fieldEdits: InspectorFieldEdits; translate: RendererTranslate;
}>) {
  function update(current: DesignNode, patch: Partial<DesignTypography>) {
    if (current.kind !== 'text') return current;
    const inherited = current.textStyleId ? editableTypography(current, projected) : undefined;
    return { ...current, ...inherited, ...patch, textStyleId: undefined };
  }
  const chooseStyle = bindDesignValue(fieldEdits, (current, { id, style }: DesignStyleChoice) => {
    if (current.kind !== 'text') return current;
    const typography = editableTypography(current, style?.kind === 'text' ? style.typography : projected);
    return { ...current, ...typography, textStyleId: id };
  });
  const bindText = bindDesignValue(fieldEdits, (current, next: DesignText) => current.kind === 'text'
    ? { ...current, text: next.text, runs: rebaseDesignTextRuns(current.text, next.text, current.runs), variableIds: next.variableIds } : current);
  const bindTypography = bindDesignValue(fieldEdits, (current, next: DesignTypography) => current.kind === 'text'
    ? { ...current, ...designTypographyOf(next), variableIds: next.variableIds, textStyleId: undefined } : current);
  const label = t('feature.design.text');
  return <InspectorSection title={label} action={<DesignVariableField target={node} field="text" label={label} disabled={disabled}
    translate={t} onBind={bindText.onSave} onBindPreview={bindText.onPreview}>
    {(_, linked) => <DesignRichTextEditor node={projected} disabled={disabled || linked} translate={t}
      onSave={(text, runs) => onSave({ ...node, text, runs })} />}
  </DesignVariableField>}>
    <DesignStyleSelect kind="text" value={node.textStyleId} disabled={disabled} translate={t}
      onPreview={chooseStyle.onPreview} onChange={(choice) => { void chooseStyle.onSave(choice); }} />
    <DesignTypographyFields typography={projected} target={node.textStyleId ? { ...editableTypography(node, projected), variableIds: node.variableIds } : node}
      disabled={disabled} translate={t}
      onBind={bindTypography.onSave} onBindPreview={bindTypography.onPreview}
      onSave={(patch) => fieldEdits.onFieldSave((current) => update(current, patch))}
      onPreview={(patch, owner) => fieldEdits.onFieldPreview(owner, patch && ((current) => update(current, patch)))} />
  </InspectorSection>;
}

function editableTypography(node: DesignText, inherited: DesignTypography): DesignTypography {
  const typography = designTypographyOf(inherited);
  for (const field of designTypographyVariableFields) {
    if (node.variableIds?.[field]) Object.assign(typography, { [field]: node[field] });
  }
  return typography;
}
