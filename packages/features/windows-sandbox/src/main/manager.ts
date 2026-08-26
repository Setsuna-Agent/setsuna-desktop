import type {
  DesktopWindowsSandboxAction,
  DesktopWindowsSandboxState,
  DesktopWindowsSandboxStatus,
} from '../contracts/index.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const STATUS_TIMEOUT_MS = 30_000;
const ACTION_TIMEOUT_MS = 10 * 60_000;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const SIDECAR_PROTOCOL_VERSION = 1;

type WindowsSandboxManagerOptions = {
  architecture?: NodeJS.Architecture;
  executablePath?: string;
  platform?: NodeJS.Platform;
  runSidecar?: (command: string, timeoutMs: number) => Promise<string>;
};

type SidecarStatus = {
  installSupported?: unknown;
  installedVersion?: unknown;
  platform?: unknown;
  protocolVersion?: unknown;
  reason?: unknown;
  sidecarVersion?: unknown;
  state?: unknown;
};

type SidecarOutput = {
  error?: { message?: unknown };
  status?: SidecarStatus;
};

const SIDECAR_STATES = new Set<DesktopWindowsSandboxState>([
  'unsupported',
  'not-installed',
  'ready',
  'needs-repair',
]);

/** Owns sidecar lifecycle operations; execution requests stay in the runtime. */
export class WindowsSandboxManager {
  private readonly architecture: NodeJS.Architecture;
  private readonly platform: NodeJS.Platform;
  private readonly runSidecar: (command: string, timeoutMs: number) => Promise<string>;
  private actionInProgress = false;

  constructor(private readonly options: WindowsSandboxManagerOptions) {
    this.architecture = options.architecture ?? process.arch;
    this.platform = options.platform ?? process.platform;
    this.runSidecar = options.runSidecar ?? ((command, timeoutMs) => this.exec(command, timeoutMs));
  }

  async getStatus(): Promise<DesktopWindowsSandboxStatus> {
    const unavailable = this.unavailableStatus();
    if (unavailable) return unavailable;
    try {
      return this.parseStatus(await this.runSidecar('doctor', STATUS_TIMEOUT_MS));
    } catch (error) {
      return this.status('needs-repair', errorMessage(error), true);
    }
  }

  async runAction(action: DesktopWindowsSandboxAction): Promise<DesktopWindowsSandboxStatus> {
    const unavailable = this.unavailableStatus();
    if (unavailable) throw new Error(unavailable.reason);
    if (!['install', 'repair', 'uninstall'].includes(action)) {
      throw new Error(`Unsupported Windows sandbox action: ${String(action)}`);
    }
    if (this.actionInProgress) throw new Error('A Windows sandbox operation is already in progress.');

    this.actionInProgress = true;
    try {
      return this.parseStatus(await this.runSidecar(action, ACTION_TIMEOUT_MS));
    } finally {
      this.actionInProgress = false;
    }
  }

  private async exec(command: string, timeoutMs: number): Promise<string> {
    const executablePath = this.options.executablePath;
    if (!executablePath) throw new Error('Windows sandbox sidecar is unavailable.');
    try {
      const { stdout } = await execFileAsync(executablePath, [command], {
        encoding: 'utf8',
        maxBuffer: MAX_OUTPUT_BYTES,
        timeout: timeoutMs,
        windowsHide: true,
      });
      return stdout;
    } catch (error) {
      const stdout = typeof (error as { stdout?: unknown })?.stdout === 'string'
        ? (error as { stdout: string }).stdout
        : '';
      const sidecarError = parseOutput(stdout)?.error?.message;
      throw new Error(
        typeof sidecarError === 'string' && sidecarError.trim()
          ? sidecarError
          : errorMessage(error),
        { cause: error },
      );
    }
  }

  private parseStatus(output: string): DesktopWindowsSandboxStatus {
    const value = parseOutput(output);
    if (!value?.status) {
      const sidecarError = value?.error?.message;
      throw new Error(typeof sidecarError === 'string' ? sidecarError : 'Windows sandbox returned no status.');
    }
    if (value.status.protocolVersion !== SIDECAR_PROTOCOL_VERSION) {
      throw new Error(
        `Windows sandbox protocol mismatch: expected ${SIDECAR_PROTOCOL_VERSION}, received ${String(value.status.protocolVersion ?? 'unknown')}.`,
      );
    }
    const state = value.status.state;
    if (typeof state !== 'string' || !SIDECAR_STATES.has(state as DesktopWindowsSandboxState)) {
      throw new Error('Windows sandbox returned an invalid state.');
    }
    return {
      architecture: this.architecture,
      installSupported: value.status.installSupported === true,
      ...(typeof value.status.installedVersion === 'string'
        ? { installedVersion: value.status.installedVersion }
        : {}),
      platform: typeof value.status.platform === 'string' ? value.status.platform : this.platform,
      ...(typeof value.status.protocolVersion === 'number'
        ? { protocolVersion: value.status.protocolVersion }
        : {}),
      reason: typeof value.status.reason === 'string' ? value.status.reason : '',
      ...(typeof value.status.sidecarVersion === 'string'
        ? { sidecarVersion: value.status.sidecarVersion }
        : {}),
      state: state as DesktopWindowsSandboxState,
    };
  }

  private unavailableStatus(): DesktopWindowsSandboxStatus | null {
    if (this.platform !== 'win32') {
      return this.status('unsupported', 'Windows native sandbox is only available on Windows.', false);
    }
    if (this.architecture !== 'x64') {
      return this.status('unsupported', `Windows ${this.architecture} is not supported yet.`, false);
    }
    if (!this.options.executablePath) {
      return this.status('unavailable', 'Windows sandbox sidecar is missing from this build.', false);
    }
    return null;
  }

  private status(
    state: DesktopWindowsSandboxState,
    reason: string,
    installSupported: boolean,
  ): DesktopWindowsSandboxStatus {
    return {
      architecture: this.architecture,
      installSupported,
      platform: this.platform,
      reason,
      state,
    };
  }
}

function parseOutput(output: string): SidecarOutput | null {
  const line = output.trim().split(/\r?\n/u).filter(Boolean).at(-1);
  if (!line) return null;
  try {
    const value = JSON.parse(line) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as SidecarOutput
      : null;
  } catch {
    return null;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? 'Windows sandbox operation failed.');
}
