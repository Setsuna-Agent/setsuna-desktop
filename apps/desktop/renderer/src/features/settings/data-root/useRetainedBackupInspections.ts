import type {
  DesktopDataRootRetainedBackup,
  DesktopDataRootRetainedBackupInspection,
} from '@setsuna-desktop/contracts';
import { useEffect, useState } from 'react';

export type RetainedBackupInspections = Record<
  string,
  DesktopDataRootRetainedBackupInspection | undefined
>;

export function useRetainedBackupInspections(
  backups: readonly DesktopDataRootRetainedBackup[],
): RetainedBackupInspections {
  const [inspections, setInspections] = useState<RetainedBackupInspections>({});

  useEffect(() => {
    let active = true;
    const backupIds = new Set(backups.map((backup) => backup.id));
    setInspections((current) => Object.fromEntries(
      Object.entries(current).filter(([backupId]) => backupIds.has(backupId)),
    ));
    const api = window.setsunaDesktop?.dataRoot;
    if (!api) return () => { active = false; };

    for (const backup of backups) {
      void api.inspectRetainedBackup(backup.id)
        .then((inspection) => {
          if (!active) return;
          setInspections((current) => ({ ...current, [backup.id]: inspection }));
        })
        .catch((error: unknown) => {
          if (!active) return;
          setInspections((current) => ({
            ...current,
            [backup.id]: {
              id: backup.id,
              path: backup.path,
              status: 'unavailable',
              fileCount: 0,
              totalBytes: 0,
              error: {
                code: 'backup_inspection_failed',
                message: error instanceof Error ? error.message : String(error),
                path: backup.path,
              },
            },
          }));
        });
    }
    return () => { active = false; };
  }, [backups]);

  return inspections;
}
