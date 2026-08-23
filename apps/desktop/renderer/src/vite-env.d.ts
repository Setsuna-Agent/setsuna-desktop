/// <reference types="vite/client" />

import type {
  SetsunaDesktopBridge,
} from '@setsuna-desktop/contracts';
import type { ReviewPreloadBridgeContribution } from '@setsuna-desktop/feature-review/contracts';
import type { TerminalPreloadBridgeContribution } from '@setsuna-desktop/feature-terminal/contracts';

declare global {
  interface Window {
    setsunaDesktop?: SetsunaDesktopBridge
      & ReviewPreloadBridgeContribution
      & TerminalPreloadBridgeContribution;
  }
}
