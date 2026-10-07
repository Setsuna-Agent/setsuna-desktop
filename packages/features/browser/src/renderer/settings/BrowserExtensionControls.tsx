import { Switch } from '@setsuna-desktop/renderer-ui';
import { Pin, Settings2, Trash2 } from 'lucide-react';
import type { BrowserExtension } from '../../contracts/extensions.js';
import type { BrowserSettingsContentProps } from './types.js';
import type { useBrowserExtensions } from '../extensions/useBrowserExtensions.js';

export function BrowserExtensionControls({ item, controller, ui, translate: t }: Pick<BrowserSettingsContentProps, 'ui' | 'translate'> & {
  item: BrowserExtension; controller: ReturnType<typeof useBrowserExtensions>;
}) {
  const pinned = controller.pinnedIds.includes(item.id);
  return <>
    <ui.IconButton label={t(pinned ? 'feature.browser.extension.unpin' : 'feature.browser.extension.pin')} aria-pressed={pinned}
      onClick={() => controller.togglePin(item.id)}><Pin size={14} fill={pinned ? 'currentColor' : 'none'} /></ui.IconButton>
    {item.hasOptions ? <ui.IconButton disabled={controller.busy || !item.enabled} label={t('feature.browser.extension.options')}
      onClick={() => void controller.open(item.id, 'options')}><Settings2 size={14} /></ui.IconButton> : null}
    <ui.IconButton disabled={controller.busy} label={t('feature.browser.extension.remove')}
      onClick={() => void controller.remove(item.id)}><Trash2 size={14} /></ui.IconButton>
    <Switch checked={item.enabled} disabled={controller.busy}
      label={`${t(item.enabled ? 'feature.browser.extension.disable' : 'feature.browser.extension.enable')} ${item.name}`}
      onCheckedChange={(enabled) => void controller.setEnabled(item.id, enabled)} />
  </>;
}
