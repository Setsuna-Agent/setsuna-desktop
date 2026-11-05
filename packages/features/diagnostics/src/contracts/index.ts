import type { DesktopOpenPathResult } from '@setsuna-desktop/contracts';
import { defineFeature } from '@setsuna-desktop/feature-core/definition';

export const diagnosticsFeature = defineFeature('diagnostics');
export const DIAGNOSTICS_CHANNELS = {
  directory: 'diagnostics:log-directory',
  openDirectory: 'diagnostics:open-log-directory',
} as const;

export type DiagnosticLogsBridge = Readonly<{
  getLogDirectory(): Promise<string>;
  openLogDirectory(): Promise<DesktopOpenPathResult>;
}>;
export type DiagnosticsPreloadContribution = Readonly<{ diagnostics: DiagnosticLogsBridge }>;
