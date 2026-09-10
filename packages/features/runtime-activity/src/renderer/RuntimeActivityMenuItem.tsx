import { Button } from '@setsuna-desktop/renderer-ui';
import { Gauge } from 'lucide-react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';

export function RuntimeActivityMenuItem({
  onClick,
  translate,
}: Readonly<{ onClick: () => void; translate: RendererTranslate }>) {
  return (
    <Button variant="ghost" type="button" role="menuitem" aria-haspopup="dialog" onClick={onClick}>
      <Gauge size={13} />
      {translate('feature.runtimeActivity.title')}
    </Button>
  );
}
