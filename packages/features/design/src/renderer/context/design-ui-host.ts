import type { SetsunaDesktopBridge, WorkspaceProjectIcon } from '@setsuna-desktop/contracts';
import { createContext, type ComponentType, type ReactNode, type RefObject } from 'react';
import type { DesignMcpBridge } from '../../contracts/design-mcp.js';
import type { useDesignShortcutSettings } from './design-canvas-settings.js';
import type { designShortcutCommands } from '../settings/design-shortcuts.js';

export type DesignShortcutSettingsProps = ReturnType<typeof useDesignShortcutSettings> & Readonly<{
  commands: typeof designShortcutCommands;
  isClipboardBinding(binding: string): boolean;
}>;
export type DesignProjectIconProps = Readonly<{ icon?: WorkspaceProjectIcon; size?: number }>;

type DesignUiHost = Readonly<{
  ShortcutSettings: ComponentType<DesignShortcutSettingsProps>;
  ScrollOverlay: ComponentType<{ scrollRef: RefObject<HTMLDivElement | null> }>;
  ProjectIcon: ComponentType<DesignProjectIconProps>;
  copyText(value: string): Promise<void>;
  openExternal?: SetsunaDesktopBridge['links']['openExternal'];
  mcp?: DesignMcpBridge;
  mcpPromptModelIcon?: ReactNode;
}>;

export const DesignUiHostContext = createContext<DesignUiHost | null>(null);
