import { LibraryBig } from 'lucide-react';
import { useState } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Button, IconButton, Popover } from '@setsuna-desktop/renderer-ui';
import { designScriptPresets } from '../canvas/design-script-presets.js';
import type { DesignScriptSource } from '../canvas/design-script-source.js';
import { designInspectorPopoverPosition } from './DesignInspectorFields.js';

export function DesignScriptLibrary({ disabled, onApply, translate: t }: Readonly<{
  disabled: boolean;
  onApply(script: DesignScriptSource): void;
  translate: RendererTranslate;
}>) {
  const [open, setOpen] = useState(false);
  const label = t('feature.design.scriptLibrary');
  return <Popover open={open && !disabled} onOpenChange={setOpen} {...designInspectorPopoverPosition} hideWhenDetached
    className="design-inspector-picker" contentLabel={label} content={open && !disabled ?
      <div className="design-inspector-picker__options design-panel-scroll">
        {designScriptPresets.map(({ label, name, source }) => <Button key={name} variant="ghost" size="small" onClick={() => {
          setOpen(false);
          onApply({ name, source });
        }}><span>{t(label)}</span></Button>)}
      </div> : null}>
    <IconButton size="small" label={label} disabled={disabled}><LibraryBig size={14} aria-hidden="true" /></IconButton>
  </Popover>;
}
