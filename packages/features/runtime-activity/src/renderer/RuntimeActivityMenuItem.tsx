import { Gauge } from 'lucide-react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';

export function RuntimeActivityMenuItem({
  onClick,
  translate,
}: Readonly<{ onClick: () => void; translate: RendererTranslate }>) {
  return (
    <button type="button" role="menuitem" aria-haspopup="dialog" onClick={onClick}>
      <Gauge size={13} />
      {translate('feature.runtimeActivity.title')}
    </button>
  );
}
