import type { RuntimePermissionProfile } from '@setsuna-desktop/contracts';
import { defineCapability, type CapabilityToken } from '@setsuna-desktop/feature-core/capability';

export const WINDOWS_SANDBOX_EXECUTABLE_ENV = 'SETSUNA_DESKTOP_WINDOWS_SANDBOX_PATH';
export const WINDOWS_SANDBOX_CURL_ENV = 'SETSUNA_DESKTOP_SANDBOX_CURL_PATH';
export const WINDOWS_SANDBOX_CA_BUNDLE_ENV = 'SETSUNA_DESKTOP_SANDBOX_CA_BUNDLE';
export const WINDOWS_SANDBOX_HOST_PID_ENV = 'SETSUNA_DESKTOP_HOST_PID';

export type WindowsNativeSandboxCapability = Readonly<{
  supported: boolean;
  provider: 'windows-native' | '';
  reason: string;
  executablePath?: string;
}>;

export type WindowsSandboxCommandRequest = Readonly<{
  command: string;
  controlRoot: string;
  cwd: string;
  deniedGlobRegExpSources: readonly string[];
  deniedRoots: readonly string[];
  environment: Readonly<Record<string, string>>;
  ephemeralWritableRoots: readonly string[];
  executionId: string;
  networkAccess: boolean;
  permissionProfile: RuntimePermissionProfile;
  protectedWritableRoots: readonly string[];
  providerExecutable: string;
  readableRoots: readonly string[];
  workspaceRoot: string;
  writableRoots: readonly string[];
}>;

export interface WindowsSandboxRuntimeService {
  capability(): WindowsNativeSandboxCapability;
  controlRoot(): string;
  prepareEnvironment(environment: Record<string, string>): Readonly<{
    environment: Record<string, string>;
    readableRoots: readonly string[];
  }>;
  writeRequest(input: WindowsSandboxCommandRequest): Promise<string>;
}

export const windowsSandboxRuntimeServiceCapability: CapabilityToken<WindowsSandboxRuntimeService> = defineCapability({
  id: 'windows-sandbox.runtime-service',
  description: 'Windows native sandbox capability probing and sidecar request materialization',
});
