import type { BrowserWindow, Extension, Input, Session, WebContents } from 'electron';
import type { ExtensionSystemEvent } from '../../contracts/extension-api.js';
import { extensionTabDetails } from './tabs.js';

export class BrowserExtensionCommands {
  constructor(private readonly session: Session, private readonly owner: (contents: WebContents) => BrowserWindow | null,
    private readonly publish: (id: string, event: ExtensionSystemEvent) => void,
    private readonly activate: (extension: Extension, contents: WebContents) => void) {}

  getAll(extension: Extension): { name: string; description: string; shortcut: string }[] {
    return Object.entries(extension.manifest.commands ?? {}).map(([name, value]) => {
      const command = value as { description?: string; suggested_key?: Record<string, string> };
      return { name, description: command.description ?? '',
        shortcut: command.suggested_key?.[process.platform === 'darwin' ? 'mac' : 'windows'] ?? command.suggested_key?.default ?? '' };
    });
  }

  track(contents: WebContents): () => void {
    const keyDown = (event: Electron.Event, input: Input) => {
      const owner = this.owner(contents);
      if (!owner || input.type !== 'keyDown' || input.isAutoRepeat || event.defaultPrevented) return;
      for (const extension of this.session.extensions.getAllExtensions()) {
        const command = this.getAll(extension).find(({ shortcut }) => shortcut && matchesShortcut(shortcut, input));
        if (!command) continue;
        event.preventDefault();
        if (command.name === '_execute_action') this.activate(extension, contents);
        else this.publish(extension.id, { kind: 'command', command: command.name,
          tab: extensionTabDetails(contents, contents.isLoading() ? 'loading' : 'complete', undefined, owner.id) });
        break;
      }
    };
    contents.on('before-input-event', keyDown);
    return () => { contents.off('before-input-event', keyDown); };
  }
}

function matchesShortcut(shortcut: string, input: Input): boolean {
  const tokens = shortcut.split('+');
  const key = tokens.pop()?.toLowerCase();
  const modifiers = new Set(tokens.map((token) => token.toLowerCase()));
  const control = modifiers.has('ctrl') || modifiers.has('control') || modifiers.has('macctrl');
  const meta = modifiers.has('command') || (modifiers.has('ctrl') && process.platform === 'darwin');
  return Boolean(key && (key === input.key.toLowerCase() || key === input.code?.toLowerCase())
    && input.control === (control && !meta) && input.meta === meta
    && input.alt === modifiers.has('alt') && input.shift === modifiers.has('shift'));
}
