import { Play, Redo2, Undo2 } from 'lucide-react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { IconButton } from '@setsuna-desktop/renderer-ui';
import { designShortcutTitle, scrollDesignToolbar } from '../DesignTools.js';
import { DesignSettingsButton } from '../settings/DesignSettingsButton.js';
import type { DesignShortcuts } from '../settings/design-shortcuts.js';

type HistoryAction = 'undo' | 'redo';

export function DesignToolbarActions({ visible, shortcuts, disabled, history, onHistory, prototype, translate: t }: Readonly<{
  visible: boolean;
  shortcuts: DesignShortcuts;
  disabled: boolean;
  history: Readonly<Record<HistoryAction, boolean>>;
  onHistory(action: HistoryAction): void;
  prototype: { interactive: boolean; play?(): void };
  translate: RendererTranslate;
}>) {
  const preview = t(prototype.interactive || !prototype.play ? 'feature.design.prototype.preview' : 'feature.design.prototype.previewBoard');
  return <div className="design-canvas__actions" role="group" aria-label={t('feature.design.canvasActions')}>
    <div className="design-canvas__action-buttons" onWheel={scrollDesignToolbar}>
      {([['undo', Undo2], ['redo', Redo2]] as const).map(([action, Icon]) => {
        const label = t(`feature.design.${action}`);
        return <IconButton key={action} label={label} title={designShortcutTitle(label, shortcuts.label(action))}
          aria-keyshortcuts={shortcuts.ariaBindings(action)} size="small" disabled={disabled || !history[action]}
          onClick={() => onHistory(action)}><Icon size={16} /></IconButton>;
      })}
      <IconButton label={preview} size="small" disabled={disabled || !prototype.play} onClick={prototype.play}><Play size={15} /></IconButton>
    </div>
    <DesignSettingsButton visible={visible} translate={t} />
  </div>;
}
