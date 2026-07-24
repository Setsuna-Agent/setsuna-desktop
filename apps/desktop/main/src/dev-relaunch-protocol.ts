export const DESKTOP_DEV_RELAUNCH_EXIT_CODE = 75;
export const DESKTOP_DEV_RELAUNCH_EXIT_CODE_ENV =
  'SETSUNA_DESKTOP_DEV_RELAUNCH_EXIT_CODE';

export function parseDesktopDevRelaunchExitCode(
  value: string | undefined,
): number | null {
  if (!value) return null;
  const exitCode = Number(value);
  return Number.isInteger(exitCode) && exitCode > 0 && exitCode <= 255
    ? exitCode
    : null;
}

export function isDesktopDevRelaunchExit(
  code: number | null,
  signal: NodeJS.Signals | null,
): boolean {
  return signal === null && code === DESKTOP_DEV_RELAUNCH_EXIT_CODE;
}
