import { ImageIcon, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Button, IconButton, SelectField, TextArea } from '@setsuna-desktop/renderer-ui';
import type { DesignContentOverride, DesignFrame } from '../../contracts/index.js';
import { InspectorSection } from '../inspector/DesignInspectorFields.js';
import type { designInstanceContents } from './design-components.js';

export function DesignInstanceFields({ instance, entries, disabled, onContent, onReplaceImage, translate: t }: Readonly<{
  instance: DesignFrame;
  entries: ReturnType<typeof designInstanceContents>;
  disabled: boolean;
  onContent(path: string, value: DesignContentOverride | undefined): Promise<boolean>;
  onReplaceImage(path: string): void;
  translate: RendererTranslate;
}>) {
  const [selected, select] = useState('');
  const entry = entries.find(({ path }) => path === selected) ?? entries[0];
  if (!entry) return null;
  const { node, path } = entry;
  const label = t('feature.design.instanceContent');
  const canRestore = instance.contentOverrides?.[path]?.kind === node.kind;
  return <InspectorSection title={label} action={canRestore ? <IconButton size="small" disabled={disabled}
    label={t('feature.design.restoreInstanceContent')} onClick={() => { void onContent(path, undefined); }}><RotateCcw size={14} /></IconButton> : null}>
    {entries.length > 1 ? <SelectField aria-label={label} value={path} disabled={disabled} onValueChange={select}>
      {entries.map(({ path, node }) => <option key={path} value={path}>
        {node.name || (node.kind === 'text' ? node.text.trim().split('\n', 1)[0] : node.assetPath.split('/').at(-1)) || t(`feature.design.${node.kind}`)}
      </option>)}
    </SelectField> : null}
    {node.kind === 'text' ? <TextArea key={`${path}:${node.text}`} aria-label={node.name || t('feature.design.text')}
      defaultValue={node.text} rows={2} disabled={disabled} onBlur={(event) => {
        const input = event.currentTarget;
        if (input.value === node.text) return;
        void onContent(path, { kind: 'text', text: input.value }).then((ok) => {
          if (!ok && input.isConnected) input.value = node.text;
        });
      }} onKeyDown={(event) => {
        event.stopPropagation();
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          event.currentTarget.value = node.text;
          event.currentTarget.blur();
        } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }} /> : <Button className="design-inspector__image-action" size="small" variant="ghost" icon={<ImageIcon size={14} />}
        disabled={disabled} title={node.assetPath} onClick={() => onReplaceImage(path)}>{t('feature.design.replaceImage')}</Button>}
  </InspectorSection>;
}
