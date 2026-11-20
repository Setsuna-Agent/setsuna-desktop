import { Maximize2, Minimize2, Play, Square, Upload } from 'lucide-react';
import { useRef, type ReactNode } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Button, IconButton, SelectField, useToast } from '@setsuna-desktop/renderer-ui';
import { parseDesignScriptPath, parseDesignWebUrl, type DesignScript, type DesignWeb } from '../../contracts/index.js';
import { designWebZoomLevels } from '../../contracts/design-content-source.js';
import type { DesignWebLayerControls } from '../canvas/DesignWebToolbar.js';
import type { DesignScriptSource } from '../canvas/design-script-source.js';
import { InspectorField, InspectorSection } from './DesignInspectorFields.js';
import { DesignScriptLibrary } from './DesignScriptLibrary.js';
import { DesignScriptParameterFields, type DesignScriptParameterEdits } from './DesignScriptParameterFields.js';

export function DesignContentSourceFields({ node, onSave, web, onImport, onConvert, scriptParameters, disabled, translate: t }: Readonly<{
  node: DesignWeb | DesignScript;
  onSave(node: DesignWeb | DesignScript): Promise<boolean>;
  web?: DesignWebLayerControls;
  onImport?(script: File | DesignScriptSource): void;
  onConvert?(): void;
  scriptParameters?: DesignScriptParameterEdits;
  disabled: boolean;
  translate: RendererTranslate;
}>) {
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);

  async function saveScript(input: string) {
    if (node.kind !== 'script') return false;
    const next = input.trim();
    let scriptPath: string | undefined;
    try {
      scriptPath = next ? parseDesignScriptPath(next.replace(/\\/gu, '/')) : undefined;
    } catch {
      toast.error(t('feature.design.scriptPathInvalid'));
      return false;
    }
    return scriptPath === node.scriptPath || onSave({ ...node, scriptPath, scriptInputs: undefined });
  }

  if (node.kind === 'script') return <InspectorSection title={t('feature.design.script')} action={onImport ?
    <DesignScriptLibrary disabled={disabled} onApply={onImport} translate={t} /> : undefined}>
    <InspectorField label={t('feature.design.scriptPath')} placeholder={t('feature.design.scriptPath')}
      value={node.scriptPath ?? ''} readOnly={disabled} onSave={saveScript}
      trailing={onImport ? <IconButton size="small" label={t('feature.design.importScript')} disabled={disabled}
        onClick={() => fileInput.current?.click()}><Upload size={14} /></IconButton> : undefined} />
    {onImport ? <input ref={fileInput} type="file" accept=".js" hidden disabled={disabled} onChange={(event) => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = '';
      if (file) onImport(file);
    }} /> : null}
    {scriptParameters ? <DesignScriptParameterFields key={node.scriptPath} {...scriptParameters}
      inputs={node.scriptInputs} disabled={disabled} translate={t} /> : null}
    <Button variant="secondary" size="small" disabled={disabled || !onConvert} onClick={onConvert}>
      {t('feature.design.convertScript')}
    </Button>
  </InspectorSection>;

  const zoom = node.zoom ?? 1;
  const levels = [...new Set([...designWebZoomLevels, zoom])].sort((a, b) => a - b);
  const deviceLabel = t('feature.design.webDevice');
  const zoomLabel = t('feature.design.webZoom');
  const expanded = web?.mode === 'expanded';
  return <InspectorSection title={t('feature.design.web')} action={web ? <div className="design-inspector__web-actions">
    <IconButton size="small" label={t(web.mode ? 'feature.design.stopWebPreview' : 'feature.design.openWebPreview')}
      aria-pressed={Boolean(web.mode)} disabled={disabled || !web.canBrowse} onClick={web.browse}>
      {web.mode ? <Square size={13} /> : <Play size={13} />}
    </IconButton>
    <IconButton size="small" label={t(expanded ? 'feature.design.collapseWebPreview' : 'feature.design.expandWebPreview')}
      aria-pressed={expanded} disabled={disabled || !web.canBrowse} onClick={web.expand}>
      {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
    </IconButton>
  </div> : undefined}>
    <WebSetting label={t('feature.design.webAddress')}>
      <DesignWebAddressField value={node.url} readOnly={disabled} onSave={(url) => web ? web.save({ url }) : onSave({ ...node, url })} translate={t} />
    </WebSetting>
    {web ? <>
      <WebSetting label={deviceLabel}>
        <SelectField aria-label={deviceLabel} value={web.devices.find(({ id }) => id === node.deviceId)?.id ?? ''}
          disabled={disabled} onValueChange={(id) => { void web.save({ deviceId: id || undefined }); }}>
          {web.devices.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
        </SelectField>
      </WebSetting>
      <WebSetting label={zoomLabel}>
        <SelectField aria-label={zoomLabel} value={String(zoom)} disabled={disabled}
          onValueChange={(value) => { void onSave({ ...node, zoom: Number(value) }); }}>
          {levels.map((level) => <option key={level} value={level}>{Math.round(level * 100)}%</option>)}
        </SelectField>
      </WebSetting>
    </> : null}
  </InspectorSection>;
}

export function DesignWebAddressField({ value, readOnly, placeholder, onSave, translate: t }: Readonly<{
  value?: string;
  readOnly: boolean;
  placeholder?: string;
  onSave(url: string | undefined): Promise<boolean>;
  translate: RendererTranslate;
}>) {
  const toast = useToast();
  return <InspectorField label={t('feature.design.webAddress')} value={value ?? ''} placeholder={placeholder}
    readOnly={readOnly} onSave={(input) => {
      const next = input.trim();
      let url: string | undefined;
      try { url = next ? parseAddress(next) : undefined; }
      catch {
        toast.error(t('feature.design.webAddressInvalid'));
        return Promise.resolve(false);
      }
      return onSave(url);
    }} />;
}

function WebSetting({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return <div className="design-inspector__web-setting"><span aria-hidden="true">{label}</span>{children}</div>;
}

function parseAddress(address: string) {
  if (address.includes('://')) return parseDesignWebUrl(address);
  const protocol = /^(?:localhost|127\.0\.0\.1|\[::1\])(?=[:/?#]|$)/iu.test(address) ? 'http' : 'https';
  return parseDesignWebUrl(`${protocol}://${address}`);
}
