import {
  prepareDesktopWindowsSandbox,
  type PreparedDesktopWindowsSandbox,
  type WindowsSandboxMainHost,
} from '@setsuna-desktop/feature-windows-sandbox/main';

export { prepareDesktopWindowsSandbox };
export type { PreparedDesktopWindowsSandbox };

export function createWindowsSandboxMainHost(input: WindowsSandboxMainHost): WindowsSandboxMainHost {
  return Object.freeze(input);
}
