import { ChevronDown } from 'lucide-react';
import { useRef, useState } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Button, Popover, useToast } from '@setsuna-desktop/renderer-ui';
import type { DesignVector } from '../../contracts/index.js';
import { DesignLucidePicker, designLucideLabel } from '../vectors/DesignLucidePicker.js';
import type { DesignLucideSource } from '../vectors/design-svg-source.js';
import { designInspectorPopoverPosition, InspectorSection } from './DesignInspectorFields.js';
import { previewDesignNode, type InspectorFieldEdits } from './design-inspector-edit.js';

export function DesignIconField({ node, icon, disabled, onSave, fieldEdits, translate: t }: Readonly<{
  node: DesignVector;
  icon: string;
  disabled: boolean;
  onSave(node: DesignVector): Promise<boolean>;
  fieldEdits: InspectorFieldEdits;
  translate: RendererTranslate;
}>) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);

  async function replacement(source: DesignLucideSource): Promise<DesignVector> {
    const { readDesignSvg, designSvgGeometry } = await import('../vectors/design-svg-import.js');
    const asset = await readDesignSvg(source);
    const name = !node.name || node.name === designLucideLabel(icon, t) ? source.name : node.name;
    return { ...node, name, geometry: designSvgGeometry(asset) };
  }

  async function replace(source: DesignLucideSource) {
    if (disabled || saving.current) return;
    if (source.icon === icon) { setOpen(false); return; }
    saving.current = true;
    setBusy(true);
    try {
      if (await onSave(await replacement(source))) setOpen(false);
    } catch {
      toast.error(t('feature.design.importSvgFailed'));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  return <InspectorSection title={t('feature.design.icon')}>
    <Popover open={open} onOpenChange={(next) => { if (!saving.current) setOpen(next); }}
      {...designInspectorPopoverPosition} className="design-icon-picker__popover" hideWhenDetached contentLabel={t('feature.design.changeIcon')}
      content={open ? <div className="design-icon-picker" onKeyDown={(event) => event.stopPropagation()} onPaste={(event) => event.stopPropagation()}>
        <DesignLucidePicker selected={icon} disabled={disabled || busy} onPick={(source) => void replace(source)}
          preview={{ prepare: replacement, show: previewDesignNode(fieldEdits) }} translate={t} />
      </div> : null}>
      <Button className="design-icon-picker__trigger" size="small" variant="ghost" title={icon}
        aria-label={t('feature.design.changeIcon')} disabled={disabled || busy}>
        <span>{icon}</span><ChevronDown size={14} aria-hidden="true" />
      </Button>
    </Popover>
  </InspectorSection>;
}
