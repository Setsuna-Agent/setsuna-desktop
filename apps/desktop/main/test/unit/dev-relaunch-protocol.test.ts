import { describe, expect, it } from 'vitest';
import {
  DESKTOP_DEV_RELAUNCH_EXIT_CODE,
  isDesktopDevRelaunchExit,
  parseDesktopDevRelaunchExitCode,
} from '../../src/dev-relaunch-protocol.js';

describe('desktop development relaunch protocol', () => {
  it('accepts only valid explicit process exit codes', () => {
    expect(parseDesktopDevRelaunchExitCode(String(DESKTOP_DEV_RELAUNCH_EXIT_CODE)))
      .toBe(DESKTOP_DEV_RELAUNCH_EXIT_CODE);
    expect(parseDesktopDevRelaunchExitCode(undefined)).toBeNull();
    expect(parseDesktopDevRelaunchExitCode('0')).toBeNull();
    expect(parseDesktopDevRelaunchExitCode('256')).toBeNull();
    expect(parseDesktopDevRelaunchExitCode('not-a-number')).toBeNull();
  });

  it('restarts only a clean exit carrying the dedicated relaunch code', () => {
    expect(isDesktopDevRelaunchExit(DESKTOP_DEV_RELAUNCH_EXIT_CODE, null)).toBe(true);
    expect(isDesktopDevRelaunchExit(0, null)).toBe(false);
    expect(isDesktopDevRelaunchExit(DESKTOP_DEV_RELAUNCH_EXIT_CODE, 'SIGTERM')).toBe(false);
  });
});
