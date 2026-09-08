import {
  defineKeyedRendererSlot,
  defineListRendererSlot,
  defineSingleRendererSlot,
} from '@setsuna-desktop/feature-core/renderer';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import type { ButtonHTMLAttributes, ComponentType, ReactNode } from 'react';

export type RendererAppRouteId = 'capabilities' | 'chat' | 'plugin' | 'settings';
export type RendererPluginViewKey = string;

export type AppReadySlotProps = Readonly<{
  /** Host implementation used by the built-in shell contribution. */
  renderDefault(): ReactNode;
}>;

export type ShellRouteSlotProps = Readonly<{
  routeId: RendererAppRouteId;
  /** Host route implementation used by the built-in route contribution. */
  renderDefault(): ReactNode;
}>;

export type ShellRegionSlotProps = Readonly<{
  renderDefault(): ReactNode;
}>;

export type ShellSidebarPluginEntrySlotProps = Readonly<{
  activeViewKey: RendererPluginViewKey | null;
  projectId?: string;
  threadId?: string;
  onOpen(viewKey: RendererPluginViewKey): void;
}>;

export type ShellPluginPageSlotProps = Readonly<{
  cwd?: string;
  projectId?: string;
  threadId?: string;
  renderUnavailable(): ReactNode;
}>;

export type ShellTopbarIconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & Readonly<{
  children: ReactNode;
  label: string;
}>;

export type ShellTopbarActionSlotProps = Readonly<{
  activeRouteId: RendererAppRouteId;
  translate: RendererTranslate;
  ui: Readonly<{
    IconButton: ComponentType<ShellTopbarIconButtonProps>;
  }>;
}>;

export const appReadySlot = defineSingleRendererSlot<AppReadySlotProps>({
  id: 'renderer.app.ready',
  scope: 'app',
  userConfigurable: true,
});

export const shellRouteSlot = defineKeyedRendererSlot<RendererAppRouteId, ShellRouteSlotProps>({
  id: 'renderer.shell.route',
  scope: 'app',
  userConfigurable: true,
});

export const shellSidebarSlot = defineSingleRendererSlot<ShellRegionSlotProps>({
  id: 'renderer.shell.sidebar',
  scope: 'app',
  userConfigurable: true,
});

/** Host-owned outlet for declarative Plugin feature navigation only. */
export const shellSidebarPluginEntrySlot = defineListRendererSlot<ShellSidebarPluginEntrySlotProps>({
  id: 'renderer.shell.sidebar.plugin-entry',
  scope: 'app',
  userConfigurable: true,
});

/** Standalone Plugin pages are keyed so install/remove can mount transactionally. */
export const shellPluginPageSlot = defineKeyedRendererSlot<RendererPluginViewKey, ShellPluginPageSlotProps>({
  id: 'renderer.shell.plugin-page',
  scope: 'app',
  userConfigurable: true,
});

export const shellTopbarTitleSlot = defineSingleRendererSlot<ShellRegionSlotProps>({
  id: 'renderer.shell.topbar.title',
  scope: 'app',
  userConfigurable: true,
});

export const shellTopbarActionsSlot = defineSingleRendererSlot<ShellRegionSlotProps>({
  id: 'renderer.shell.topbar.actions',
  scope: 'app',
  userConfigurable: true,
});

export const shellTopbarActionSlot = defineListRendererSlot<ShellTopbarActionSlotProps>({
  id: 'renderer.shell.topbar.action',
  scope: 'app',
  userConfigurable: true,
});

export const shellWorkspaceToolbarSlot = defineSingleRendererSlot<ShellRegionSlotProps>({
  id: 'renderer.shell.workspace-toolbar',
  scope: 'app',
  userConfigurable: true,
});

export const shellOverlaySlot = defineSingleRendererSlot<ShellRegionSlotProps>({
  id: 'renderer.shell.overlay',
  scope: 'app',
  userConfigurable: true,
});

export function rendererPluginViewKey(pluginId: string, contributionId: string): RendererPluginViewKey {
  return `${pluginId}/${contributionId}`;
}
