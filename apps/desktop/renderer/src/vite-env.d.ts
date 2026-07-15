/// <reference types="vite/client" />

import type {
  SetsunaDesktopBridge,
} from '@setsuna-desktop/contracts';

declare global {
  interface Window {
    setsunaDesktop?: SetsunaDesktopBridge;
  }
}
