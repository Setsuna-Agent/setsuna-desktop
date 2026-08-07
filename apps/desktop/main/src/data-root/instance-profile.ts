import path from 'node:path';

const DEVELOPMENT_PROFILE_DIRECTORY_NAME = 'Setsuna Desktop Development';
const DEVELOPMENT_DATA_DIRECTORY_NAME = 'Data';

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
}): DesktopInstanceProfile {
  const appDataRoot = path.resolve(input.appDataRoot);
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
