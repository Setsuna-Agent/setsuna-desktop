import { ImagePlus, Upload } from 'lucide-react';
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Checkbox, IconButton, SegmentedControl, SelectField, useToast } from '@setsuna-desktop/renderer-ui';
import { maxDesignShaderBytes, parseDesignShaderName, parseDesignShaderPath, parseDesignShaderSource,
  type DesignShaderPaint, type DesignShaderSampler, type DesignShaderValue } from '../../contracts/design-shader.js';
import { DesignImagePopover, type DesignImageAssets } from '../DesignImagePicker.js';
import { InspectorField, InspectorGroup, NumberField } from '../inspector/DesignInspectorFields.js';
import { DesignNumberSliderField } from '../inspector/DesignNumberSliderField.js';
import { ColorField } from '../inspector/DesignPaintField.js';
import { DesignShaderLibrary } from './DesignShaderLibrary.js';
import type { DesignShaderSource } from './design-shader-presets.js';
import { validateDesignShader } from './design-shader-renderer.js';
import { designShaderUniformValue, readDesignShaderUniforms, type DesignShaderUniform } from './design-shader-uniforms.js';
import { DesignShaderAssetsContext } from './use-design-shader-assets.js';

export function DesignShaderFields({ paint, imageAssets, disabled, onSave, onPreview, translate: t }: Readonly<{
  paint: DesignShaderPaint | undefined;
  imageAssets: DesignImageAssets;
  disabled: boolean;
  onSave(next: DesignShaderPaint): Promise<boolean>;
  onPreview(next: DesignShaderPaint | undefined): void;
  translate: RendererTranslate;
}>) {
  const assets = useContext(DesignShaderAssetsContext);
  const upload = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController>();
  const [pending, setPending] = useState(false);
  const toast = useToast();
  const source = paint ? assets?.sources.get(paint.assetPath) : undefined;
  const uniforms = useMemo(() => source ? readDesignShaderUniforms(source) : [], [source]);
  useEffect(() => () => request.current?.abort(), []);

  async function apply(input: string | File | DesignShaderSource) {
    if (!assets || disabled || request.current || input === paint?.assetPath) return false;
    const controller = new AbortController();
    request.current = controller;
    const { signal } = controller;
    setPending(true);
    try {
      let path: string;
      let source: string;
      if (typeof input === 'string') {
        path = parseDesignShaderPath(input.trim());
        source = await assets.read(path, signal);
        signal.throwIfAborted();
        validateDesignShader(source);
      } else {
        const file = 'source' in input ? input : { name: parseDesignShaderName(input.name), source: await readLocalShader(input, t) };
        source = file.source;
        signal.throwIfAborted();
        validateDesignShader(source);
        path = await assets.store({ name: file.name, source }, signal);
      }
      signal.throwIfAborted();
      assets.remember(path, source);
      return await onSave({ assetPath: path });
    } catch (error) {
      if (!signal.aborted) toast.error(t('feature.design.shaderFailed', { error: error instanceof Error ? error.message : String(error) }));
      return false;
    } finally {
      request.current = undefined;
      if (!signal.aborted) setPending(false);
    }
  }

  const blocked = disabled || pending || !assets;
  const paths = assets?.paths ?? [];
  return <div className="design-shader-fields">
    <div className="design-paint-picker__source">
      <InspectorField label={t('feature.design.shaderPath')} placeholder={t('feature.design.shaderPath')}
        value={paint?.assetPath ?? ''} readOnly={blocked} spellCheck={false} onSave={apply} />
      <div className="design-shader-fields__actions">
        <DesignShaderLibrary disabled={blocked} current={source} translate={t} onApply={(preset) => { void apply(preset); }} />
        <IconButton size="small" label={t('feature.design.importShader')} disabled={blocked} onClick={() => upload.current?.click()}>
          <Upload size={14} />
        </IconButton>
      </div>
      <input ref={upload} type="file" accept=".glsl" hidden onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = '';
        if (file) void apply(file);
      }} />
    </div>
    {paths.some((path) => path !== paint?.assetPath) ? <SelectField value="" disabled={blocked}
      aria-label={t('feature.design.usedShaders')} onValueChange={(path) => { void apply(path); }}>
      <option value="" disabled>{t('feature.design.usedShaders')}</option>
      {paths.map((path) => <option key={path} value={path} disabled={path === paint?.assetPath}>{path}</option>)}
    </SelectField> : null}
    {paint ? uniforms.map((uniform) => <ShaderUniformField key={`${paint.assetPath}:${uniform.name}`} uniform={uniform} paint={paint}
      imageAssets={imageAssets} disabled={blocked} translate={t}
      onSave={(value) => onSave({ ...paint, uniforms: { ...paint.uniforms, [uniform.name]: value } })}
      onPreview={(value) => onPreview(value === undefined ? undefined : { ...paint, uniforms: { ...paint.uniforms, [uniform.name]: value } })} />) : null}
  </div>;
}

async function readLocalShader(file: File, t: RendererTranslate) {
  if (file.size > maxDesignShaderBytes) throw new Error(t('feature.design.shaderTooLarge', { size: maxDesignShaderBytes / 1024 }));
  return parseDesignShaderSource(new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()));
}

type UniformProps = Readonly<{
  uniform: DesignShaderUniform; paint: DesignShaderPaint; imageAssets: DesignImageAssets; disabled: boolean; translate: RendererTranslate;
  onSave(value: DesignShaderValue): Promise<boolean>;
  onPreview(value: DesignShaderValue | undefined): void;
}>;

const samplerKinds = ['image', 'background', 'object'] as const;
const vectorAxes = ['X', 'Y', 'Z', 'W'] as const;

function ShaderUniformField({ uniform, paint, imageAssets, disabled, onSave, onPreview, translate: t }: UniformProps) {
  if (!('initial' in uniform)) return null;
  const { label } = uniform;
  switch (uniform.kind) {
    case 'color': return <InspectorGroup title={label}>
      <ColorField label={label} value={designShaderUniformValue(uniform, paint)} editOpacity={uniform.size === 4}
        disabled={disabled} onSave={onSave} onPreview={onPreview} />
    </InspectorGroup>;
    case 'bool': return <Checkbox checked={designShaderUniformValue(uniform, paint)} disabled={disabled}
      onChange={(value) => { void onSave(value); }}>{label}</Checkbox>;
    case 'float':
    case 'int': {
      const [min, max] = uniform.range ?? [];
      const value = designShaderUniformValue(uniform, paint);
      const integer = uniform.kind === 'int';
      const field = { label, value, min, max, integer, precision: 6, readOnly: disabled, onSave, onPreview };
      return <InspectorGroup title={label}>
        {min !== undefined && max !== undefined ? <DesignNumberSliderField {...field} prefix=""
          sliderMax={max} sliderStep={uniform.step ?? (integer ? 1 : Math.min(0.01, (max - min) / 100))} />
          : <NumberField {...field} prefix="" />}
      </InspectorGroup>;
    }
    case 'vector': {
      const value = designShaderUniformValue(uniform, paint);
      const next = (index: number, component: number) => value.map((part, at) => at === index ? component : part);
      return <InspectorGroup title={label}><div className="design-inspector__pair">
        {value.map((component, index) => <NumberField key={vectorAxes[index]} label={`${label} ${vectorAxes[index]}`} prefix={vectorAxes[index]}
          value={component} precision={6} readOnly={disabled} onSave={(component) => onSave(next(index, component))}
          onPreview={(component) => onPreview(component === undefined ? undefined : next(index, component))} />)}
      </div></InspectorGroup>;
    }
    case 'sampler': {
      const value = designShaderUniformValue(uniform, paint);
      const change = (kind: DesignShaderSampler['kind']) => { if (kind !== value.kind) void onSave({ kind }); };
      return <InspectorGroup title={label}>
        <SegmentedControl label={label} value={value.kind} disabled={disabled} onChange={change}
          options={samplerKinds.map((kind) => ({ value: kind, label: t(`feature.design.shaderTexture.${kind}`) }))} />
        {value.kind === 'image' ? <div className="design-paint-picker__source">
          <InspectorField label={t('feature.design.paintImageSource')} placeholder={t('feature.design.paintImageSource')}
            readOnly value={value.assetPath ?? ''} onSave={async () => false} />
          <DesignImagePopover {...imageAssets} revision={paint.assetPath} disabled={disabled} translate={t} currentPath={value.assetPath}
            onInsert={(assetPath) => onSave({ kind: 'image', assetPath })}>
            <IconButton label={t('feature.design.choosePaintImage')} size="small" disabled={disabled}><ImagePlus size={14} /></IconButton>
          </DesignImagePopover>
        </div> : null}
      </InspectorGroup>;
    }
  }
}
