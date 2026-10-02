import path from 'node:path';

const DEVELOPMENT_PROFILE_DIRECTORY_NAME = 'Setsuna Desktop Development';
const DEVELOPMENT_DATA_DIRECTORY_NAME = 'Data';
export const COMPUTER_USE_LAB_APP_NAME = 'Setsuna Computer Use Lab';

export type DesktopInstanceProfile = {
  /** Parent used by the bootstrap layout for pointers, migrations and the process lock. */
  appDataRoot: string;
  /** Initial Electron profile and runtime data root when no custom location is selected. */
  defaultDataRoot: string;
};

/**
 * Unpackaged Electron runs beside the installed app during development. Keeping both
 * roots separate prevents the two processes from sharing Chromium state, SQLite data,
 * credentials, migration metadata or the bootstrap instance lock.
 */
export function resolveDesktopInstanceProfile(input: {
  appDataRoot: string;
  defaultDataRoot: string;
  isPackaged: boolean;
  appName?: string;
}): DesktopInstanceProfile {
  const appDataRoot = path.resolve(input.appDataRoot);
  // The signed native test app must not read the installed app's bootstrap
  // pointer, process lock, credentials or conversation database.
  if (input.isPackaged && input.appName === COMPUTER_USE_LAB_APP_NAME) {
    const labRoot = path.join(appDataRoot, COMPUTER_USE_LAB_APP_NAME);
    return { appDataRoot: labRoot, defaultDataRoot: path.join(labRoot, 'Data') };
  }
  if (input.isPackaged) {
    return {
      appDataRoot,
      defaultDataRoot: path.resolve(input.defaultDataRoot),
    };
  }

  const developmentRoot = path.join(appDataRoot, DEVELOPMENT_PROFILE_DIRECTORY_NAME);
  return {
    appDataRoot: developmentRoot,
    defaultDataRoot: path.join(developmentRoot, DEVELOPMENT_DATA_DIRECTORY_NAME),
  };
}
