import type {
  DesktopDataRootRetainedBackup,
  DesktopDataRootRetainedBackupInspection,
} from '@setsuna-desktop/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RetainedDataRootBackupList } from '../../../../../src/features/settings/data-root/RetainedDataRootBackupList.js';
import { I18nProvider } from '../../../../../src/shared/i18n/I18nProvider.js';

const backup: DesktopDataRootRetainedBackup = {
  id: 'backup_1',
  path: '/Users/demo/Documents/SetsunaData',
  createdAt: '2026-07-24T00:00:00.000Z',
  promptOnStartup: true,
};

describe('RetainedDataRootBackupList', () => {
  it('renders localized disk usage and the exact old location', () => {
    const inspection: DesktopDataRootRetainedBackupInspection = {
      id: backup.id,
      path: backup.path,
      status: 'ready',
      fileCount: 2_078,
      totalBytes: 499 * 1024 * 1024,
    };

    const html = renderList('zh-CN', inspection);

    expect(html).toContain('迁移前的旧目录');
    expect(html).toContain(backup.path);
    expect(html).toContain('499 MB');
    expect(html).toContain('2,078 个文件');
    expect(html).not.toContain('Old pre-migration location');
  });

  it('uses friendly localized copy when directory identity changed', () => {
    const inspection: DesktopDataRootRetainedBackupInspection = {
      id: backup.id,
      path: backup.path,
      status: 'changed',
      fileCount: 0,
      totalBytes: 0,
      error: {
        code: 'backup_changed',
        message: 'The directory inode changed.',
        path: backup.path,
      },
    };

    const html = renderList('zh-CN', inspection);

    expect(html).toContain('为避免误删，Setsuna 已停止清理');
    expect(html).not.toContain(inspection.error!.message);
  });
});

function renderList(
  locale: 'zh-CN' | 'en-US',
  inspection: DesktopDataRootRetainedBackupInspection,
): string {
  return renderToStaticMarkup(
    <I18nProvider initialLocale={locale}>
      <RetainedDataRootBackupList
        backups={[backup]}
        inspections={{ [backup.id]: inspection }}
      />
    </I18nProvider>,
  );
}
