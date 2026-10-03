import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { MousePointer2 } from 'lucide-react';

export function ComputerControlNotice({ translate }: Readonly<{ translate: RendererTranslate }>) {
  return (
    <aside className="computer-use-notice" role="note">
      <div className="computer-use-notice__overview">
        <div className="computer-use-notice__icon" aria-hidden="true">
          <MousePointer2 size={18} strokeWidth={1.75} />
        </div>
        <p className="computer-use-notice__copy">{translate('feature.computerUse.notice.risk')}</p>
      </div>
      <p className="computer-use-notice__model">{translate('feature.computerUse.notice.modelLimit')}</p>
    </aside>
  );
}
