import { ArrowLeft, Check, Search, Trash2, Upload } from 'lucide-react';
import { useContext, useId, useMemo, useRef, useState, type ContextType } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Button, IconButton, Popover, SegmentedControl, TextField, useHoverPreview, useToast } from '@setsuna-desktop/renderer-ui';
import { designFontFormats, designFontNameKey, type DesignCustomFont } from '../../contracts/design-fonts.js';
import { designFontFamilies } from '../../contracts/index.js';
import { DesignFontPreview, DesignFontPreviewList, designFontPreviewWeight } from './DesignFontPreview.js';
import { importableDesignFont } from './design-font-loader.js';
import { DesignFontsContext } from './use-design-fonts.js';
import './design-font-picker.css';

const accepted = Object.keys(designFontFormats).map((extension) => `.${extension}`).join(',');
const groups = ['all', 'custom'] as const;
type FontFamily = Readonly<{ family: string; face?: DesignCustomFont }>;

function previewOrder(font: DesignCustomFont): number {
  return (font.style === 'normal' ? 0 : 1000) + Math.abs(designFontPreviewWeight(font) - 400);
}

export function DesignFontPicker({ installed, value, onPreview, onSelect, translate: t }: Readonly<{
  installed: readonly string[];
  value?: string;
  onPreview?(family: string | undefined, owner: string): void;
  onSelect(family: string): void;
  translate: RendererTranslate;
}>) {
  const library = useContext(DesignFontsContext);
  const [group, setGroup] = useState<(typeof groups)[number]>('all');
  const [managing, setManaging] = useState(false);
  const [query, setQuery] = useState('');
  const preview = useHoverPreview(onPreview);
  const imported = library?.fonts;
  const term = designFontNameKey(query.trim());
  const families = useMemo<readonly FontFamily[]>(() => {
    const names = new Map<string, FontFamily>();
    if (group === 'all') for (const family of installed) names.set(designFontNameKey(family), { family });
    for (const face of imported ?? []) {
      const key = designFontNameKey(face.family);
      const previous = names.get(key)?.face;
      if (!previous || previewOrder(face) < previewOrder(previous)) names.set(key, { family: face.family, face });
    }
    if (group === 'all') for (const preset of designFontFamilies) names.delete(preset);
    const sorted = [...names.values()].sort((a, b) => a.family.localeCompare(b.family));
    return group === 'all' ? [...designFontFamilies.map((family) => ({ family })), ...sorted] : sorted;
  }, [group, imported, installed]);
  const { options, previews } = useMemo(() => {
    const options = families.flatMap(({ family, face }) => {
      const name = designFontFamilies.some((preset) => preset === family) ? t(`feature.design.font.${family}`) : family;
      return term && ![family, name].some((text) => designFontNameKey(text).includes(term)) ? [] : [{ family, face, name }];
    });
    return { options, previews: options.flatMap(({ face }) => face ? [face] : []) };
  }, [families, t, term]);
  const selectedFamily = designFontNameKey(value ?? 'system');
  const searchLabel = t('feature.design.fontSearch');
  const manageLabel = t('feature.design.manageCustomFonts');
  return <>
    <TextField autoFocus appearance="search" aria-label={searchLabel} placeholder={searchLabel} value={query}
      leadingIcon={<Search size={14} />} onChange={(event) => { preview.clear(); setQuery(event.currentTarget.value); }} />
    {managing && library ? <CustomFontManager library={library} term={term} translate={t}
      onImported={() => setQuery('')} onBack={() => setManaging(false)} /> : <>
      {library ? <SegmentedControl<typeof group> label={t('feature.design.fontFamily')} value={group}
        onChange={(next) => { preview.clear(); setGroup(next); }}
        options={groups.map((choice) => ({ value: choice, label: t(`feature.design.fontGroup.${choice}`) }))} /> : null}
      {group === 'custom' ? <Button size="small" onClick={() => { preview.clear(); setManaging(true); }}>{manageLabel}</Button> : null}
      <DesignFontPreviewList fonts={previews}>
        {options.map(({ family, name, face }) => {
          const selected = selectedFamily === designFontNameKey(family);
          return <Button key={family} size="small" variant="ghost" aria-pressed={selected} title={name}
            {...(!selected ? preview.option(() => face && library
              ? library.choose(family).then((ready) => ready ? family : undefined) : family) : undefined)}
            onClick={() => { preview.clear(); onSelect(family); }}>
            <DesignFontPreview family={family} name={name} face={face} />{selected ? <Check size={14} aria-hidden="true" /> : null}
          </Button>;
        })}
      </DesignFontPreviewList>
    </>}
  </>;
}

function CustomFontManager({ library, term, onBack, onImported, translate: t }: Readonly<{
  library: NonNullable<ContextType<typeof DesignFontsContext>>;
  term: string;
  onBack(): void;
  onImported(): void;
  translate: RendererTranslate;
}>) {
  const [pending, setPending] = useState(false);
  const operation = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const toast = useToast();
  const fonts = useMemo(() => library.fonts.filter(({ family, name }) => !term
    || [family, name].some((item) => designFontNameKey(item).includes(term))), [library.fonts, term]);

  async function run(work: () => Promise<boolean>) {
    if (operation.current) return;
    operation.current = true;
    setPending(true);
    try { if (await work()) await library.updateCatalog(); }
    finally { operation.current = false; setPending(false); }
  }

  async function importFiles(files: readonly File[]) {
    let imported = false;
    for (const file of files) {
      try {
        if (!importableDesignFont(file)) throw new Error('Invalid font file.');
        await library.import(file);
        imported = true;
      } catch {
        toast.error(t('feature.design.importFontFailed', { name: file.name }));
      }
    }
    if (imported) onImported();
    return imported;
  }
  async function remove(font: DesignCustomFont) {
    try {
      await library.remove(font.id);
      return true;
    } catch {
      toast.error(t('feature.design.removeFontFailed', { name: font.name }));
      return false;
    }
  }

  return <>
    <div className="design-font-picker__manage-actions">
      <IconButton size="small" label={t('feature.design.backToFonts')} disabled={pending} onClick={onBack}><ArrowLeft size={15} /></IconButton>
      <Button size="small" icon={<Upload size={14} />} loading={pending} aria-controls={inputId}
        onClick={() => fileInput.current?.click()}>{t('feature.design.importFont')}</Button>
      <input id={inputId} ref={fileInput} type="file" accept={accepted} multiple hidden onChange={(event) => {
        const files = Array.from(event.currentTarget.files ?? []);
        event.currentTarget.value = '';
        if (files.length) void run(() => importFiles(files));
      }} />
    </div>
    <DesignFontPreviewList fonts={fonts} label={t('feature.design.fontGroup.custom')}>
      {fonts.map((font) =>
        <div key={font.id} className="design-font-picker__font" role="listitem">
          <DesignFontPreview family={font.family} name={font.name} face={font} />
          <RemoveCustomFont font={font} disabled={pending} translate={t} onRemove={() => run(() => remove(font))} />
        </div>)}
    </DesignFontPreviewList>
  </>;
}

function RemoveCustomFont({ font, disabled, onRemove, translate: t }: Readonly<{
  font: DesignCustomFont;
  disabled: boolean;
  onRemove(): Promise<void>;
  translate: RendererTranslate;
}>) {
  const [open, setOpen] = useState(false);
  const label = t('feature.design.removeFontConfirm', { name: font.name });
  return <Popover open={open} onOpenChange={setOpen} placement="bottomRight" className="design-form-popover design-font-picker__confirm"
    contentLabel={label} content={open ? <div className="design-popover-form">
      <strong>{label}</strong>
      <div className="design-popover-form__actions">
        <Button size="small" onClick={() => setOpen(false)}>{t('feature.design.cancel')}</Button>
        <Button size="small" variant="danger" disabled={disabled}
          onClick={() => { setOpen(false); void onRemove(); }}>{t('feature.design.removeFont')}</Button>
      </div>
    </div> : null}>
    <IconButton size="small" label={label} disabled={disabled}><Trash2 size={14} /></IconButton>
  </Popover>;
}
