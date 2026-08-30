import {
  defineKeyedRendererSlot,
  defineSingleRendererSlot,
} from '@setsuna-desktop/feature-core/renderer';
import type { ReactNode } from 'react';

export type RendererAppRouteId = 'capabilities' | 'chat' | 'settings';

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
