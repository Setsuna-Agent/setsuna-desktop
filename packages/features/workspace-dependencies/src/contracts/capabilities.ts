import { defineCapability, type CapabilityToken } from '@setsuna-desktop/feature-core/capability';
import type {
  PrepareShellToolchainInput,
  RuntimeWorkspaceDependenciesStatus,
  ShellToolchain,
  WorkspaceDependencyPromptContext,
} from './types.js';
import type { WorkspaceDependencySettings } from './settings.js';

export interface WorkspaceDependenciesControl {
  getStatus(): Promise<RuntimeWorkspaceDependenciesStatus>;
  getPromptContext(): Promise<WorkspaceDependencyPromptContext>;
  diagnose(): Promise<RuntimeWorkspaceDependenciesStatus>;
  repair(): Promise<RuntimeWorkspaceDependenciesStatus>;
  prepareShellToolchain(input: PrepareShellToolchainInput): Promise<ShellToolchain>;
}

export const workspaceDependenciesControlCapability: CapabilityToken<WorkspaceDependenciesControl> = defineCapability({
  id: 'workspace-dependencies.control',
  description: 'Managed Node.js, Python, uv, and package-manager toolchain for workspace shell calls',
});

export type WorkspaceDependenciesFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface WorkspaceDependenciesRuntimeHost {
  readonly dataDir: string;
  readonly fetch: WorkspaceDependenciesFetch;
  resolveNetworkEnvironment(): Promise<Readonly<Record<string, string | null>>>;
  sandboxNetworkAccessEnabled(): Promise<boolean>;
}

export const workspaceDependenciesRuntimeHostCapability: CapabilityToken<WorkspaceDependenciesRuntimeHost> = defineCapability({
  id: 'workspace-dependencies.runtime-host',
  description: 'Runtime data root, routed network, and sandbox state required by the managed workspace toolchain',
});

export interface WorkspaceDependenciesLegacySettingsAdapter {
  read(): Promise<WorkspaceDependencySettings>;
  retire(): Promise<void>;
}

export const workspaceDependenciesLegacySettingsCapability: CapabilityToken<WorkspaceDependenciesLegacySettingsAdapter> = defineCapability({
  id: 'workspace-dependencies.legacy-settings',
  description: 'One-way reader and cleanup adapter for pre-Feature package source settings',
});
