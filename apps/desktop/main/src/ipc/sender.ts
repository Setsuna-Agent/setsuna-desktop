import type { WebContents } from 'electron';
import { desktopWindows } from '../window/registry.js';

export function isDesktopRendererSender(sender: WebContents): boolean {
  return Boolean(desktopWindows.get(sender.id));
}
