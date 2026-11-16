import type { DesktopWorkspaceApp } from './bridge.js';

export function workspaceAppSupportsTarget(app: DesktopWorkspaceApp, filePath?: string | null): boolean {
  return app.kind !== 'browser' || Boolean(filePath && /\.html?$/i.test(filePath));
}

/** A browser preference for HTML must not become the launcher for projects or source files. */
export function resolveWorkspaceApp(
  apps: readonly DesktopWorkspaceApp[],
  preferred: DesktopWorkspaceApp | null | undefined,
  filePath?: string | null,
): DesktopWorkspaceApp | null {
  if (preferred && workspaceAppSupportsTarget(preferred, filePath)) return preferred;
  return apps.find((app) => workspaceAppSupportsTarget(app, filePath)) ?? null;
}
