import type { SettingsViewUi } from '@setsuna-desktop/renderer-contracts/settings';
import type { BrowserDesktopBridge } from '../../contracts/bridge.js';
import type { BrowserTranslate } from '../messages.js';

export type BrowserSettingsContentProps = {
  bridge: BrowserDesktopBridge;
  translate: BrowserTranslate;
  ui: SettingsViewUi;
};

export type BrowserSettingsDialogProps = BrowserSettingsContentProps & {
  onClose(): void;
};
