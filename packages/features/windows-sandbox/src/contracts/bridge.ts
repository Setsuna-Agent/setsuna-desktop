export type DesktopWindowsSandboxState =
  | 'unsupported'
  | 'unavailable'
  | 'not-installed'
  | 'ready'
  | 'needs-repair';

export type DesktopWindowsSandboxStatus = {
  architecture: string;
  installSupported: boolean;
  installedVersion?: string;
  platform: string;
  protocolVersion?: number;
  reason: string;
  sidecarVersion?: string;
  state: DesktopWindowsSandboxState;
};

export type DesktopWindowsSandboxAction = 'install' | 'repair' | 'uninstall';

export const WINDOWS_SANDBOX_IPC_CHANNELS = Object.freeze({
  getStatus: 'windows-sandbox:get-status',
  runAction: 'windows-sandbox:run-action',
} as const);

export interface WindowsSandboxDesktopBridge {
  getStatus(): Promise<DesktopWindowsSandboxStatus>;
  runAction(action: DesktopWindowsSandboxAction): Promise<DesktopWindowsSandboxStatus>;
}

export type WindowsSandboxPreloadBridgeContribution = Readonly<{
  windowsSandbox: WindowsSandboxDesktopBridge;
}>;
