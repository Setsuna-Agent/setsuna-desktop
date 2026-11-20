import { ImageIcon, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Button, IconButton, SelectField } from '@setsuna-desktop/renderer-ui';
import type { DesignContentOverride, DesignFrame } from '../../contracts/index.js';
import { DesignImagePopover, type DesignImageAssets } from '../DesignImagePicker.js';
import { InspectorSection, InspectorTextArea } from '../inspector/DesignInspectorFields.js';
import { bindDesignText, type InspectorFieldEdits } from '../inspector/design-inspector-edit.js';
import { withDesignInstanceContent, type designInstanceContents } from './design-components.js';

export function DesignInstanceFields({ instance, entries, disabled, revision, imageAssets, fieldEdits, onContent, onReplaceImage, translate: t }: Readonly<{
  instance: DesignFrame;
  entries: ReturnType<typeof designInstanceContents>;
  disabled: boolean;
  revision: string;
  imageAssets: DesignImageAssets;
  fieldEdits: InspectorFieldEdits;
  onContent(path: string, value: DesignContentOverride | undefined): Promise<boolean>;
  onReplaceImage(path: string, assetPath: string): Promise<boolean>;
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
    {node.kind === 'text' ? <InspectorTextArea key={path} aria-label={node.name || t('feature.design.text')} value={node.text} rows={2}
      {...bindDesignText(fieldEdits, (instance, text) => instance.kind === 'frame' && instance.instanceOf
        ? withDesignInstanceContent(instance, path, { kind: 'text', text }) : instance)} />
      : <DesignImagePopover key={path} {...imageAssets} currentPath={node.assetPath} revision={revision} disabled={disabled}
        onInsert={(assetPath) => onReplaceImage(path, assetPath)} translate={t}>
        <Button className="design-inspector__image-action" size="small" variant="ghost" icon={<ImageIcon size={14} />}
          disabled={disabled} title={node.assetPath}>{t('feature.design.replaceImage')}</Button>
      </DesignImagePopover>}
  </InspectorSection>;
}
