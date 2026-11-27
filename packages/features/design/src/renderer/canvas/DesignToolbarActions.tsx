import { Play, Redo2, Undo2 } from 'lucide-react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { IconButton } from '@setsuna-desktop/renderer-ui';
import { designShortcutTitle, scrollDesignToolbar } from '../DesignTools.js';
import { DesignPublicationActions } from '../publication/DesignPublicationActions.js';
import type { DesignPublicationSource } from '../publication/use-design-publication.js';
import { DesignSettingsButton } from '../settings/DesignSettingsButton.js';
import type { DesignShortcuts } from '../settings/design-shortcuts.js';

type HistoryAction = 'undo' | 'redo';

export function DesignToolbarActions({ visible, shortcuts, disabled, history, onHistory, prototype, publication, translate: t }: Readonly<{
  visible: boolean;
  shortcuts: DesignShortcuts;
  disabled: boolean;
  history: Readonly<Record<HistoryAction, boolean>>;
  onHistory(action: HistoryAction): void;
  prototype: { interactive: boolean; play?(): void };
  publication?: DesignPublicationSource;
  translate: RendererTranslate;
}>) {
  const preview = t(prototype.interactive || !prototype.play ? 'feature.design.prototype.preview' : 'feature.design.prototype.previewBoard');
  const publicationBridge = publication?.client.assets.publication;
  return <div className="design-canvas__actions" role="group" aria-label={t('feature.design.canvasActions')}>
    <div className="design-canvas__action-buttons" onWheel={scrollDesignToolbar}>
      {([['undo', Undo2], ['redo', Redo2]] as const).map(([action, Icon]) => {
        const label = t(`feature.design.${action}`);
        return <IconButton key={action} label={label} title={designShortcutTitle(label, shortcuts.label(action))}
          aria-keyshortcuts={shortcuts.ariaBindings(action)} size="small" disabled={disabled || !history[action]}
          onClick={() => onHistory(action)}><Icon size={16} /></IconButton>;
      })}
      <IconButton label={preview} size="small" disabled={disabled || !prototype.play} onClick={prototype.play}><Play size={15} /></IconButton>
      {visible && publication && publicationBridge
        ? <DesignPublicationActions source={publication} bridge={publicationBridge} disabled={disabled} translate={t} /> : null}
    </div>
    <DesignSettingsButton visible={visible} translate={t} />
  </div>;
}
