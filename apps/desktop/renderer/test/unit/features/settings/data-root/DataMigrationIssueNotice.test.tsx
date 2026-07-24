import type { DesktopDataMigrationIssue } from '@setsuna-desktop/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DataMigrationIssueNotice } from '../../../../../src/features/settings/data-root/DataMigrationIssueNotice.js';
import { I18nProvider } from '../../../../../src/shared/i18n/I18nProvider.js';

describe('DataMigrationIssueNotice', () => {
  it('renders a friendly Chinese symlink explanation and the offending path', () => {
    const issue: DesktopDataMigrationIssue = {
      code: 'symlink_not_supported',
      message: 'Only symlinks that resolve inside the data root can be migrated.',
      path: '/Users/demo/Setsuna/runtime/workspace-dependencies/bin/python',
    };

    const html = renderIssue(issue, 'zh-CN', '/Users/demo/Documents/SetsunaData');

    expect(html).toContain('发现无法安全迁移的符号链接');
    expect(html).toContain('下方链接指向当前数据目录之外');
    expect(html).toContain('请移走或删除该链接');
    expect(html).toContain('问题位置');
    expect(html).toContain(issue.path);
    expect(html).toContain('role="alert"');
    expect(html).not.toContain(issue.message);
  });

  it('uses target-specific guidance when the selected target is itself a symlink', () => {
    const targetRoot = '/Users/demo/Documents/SetsunaData';
    const issue: DesktopDataMigrationIssue = {
      code: 'symlink_not_supported',
      message: 'A symlink cannot be used as the Setsuna data root.',
      path: targetRoot,
    };

    const html = renderIssue(issue, 'zh-CN', targetRoot);

    expect(html).toContain('目标目录是符号链接');
    expect(html).toContain('请直接选择该链接实际指向的本地目录');
  });

  it('renders warnings in the selected English locale', () => {
    const issue: DesktopDataMigrationIssue = {
      code: 'network_or_cloud_location',
      message: 'Network or cloud-synchronized locations are not recommended.',
      path: '/Volumes/NAS/SetsunaData',
    };

    const html = renderIssue(issue, 'en-US', '/Volumes/NAS/SetsunaData', 'warning');

    expect(html).toContain('This may be a network or cloud-synced location');
    expect(html).toContain('Problem location');
    expect(html).toContain('role="status"');
    expect(html).not.toContain(issue.message);
  });
});

function renderIssue(
  issue: DesktopDataMigrationIssue,
  locale: 'zh-CN' | 'en-US',
  targetRoot: string,
  severity: 'blocker' | 'warning' = 'blocker',
): string {
  return renderToStaticMarkup(
    <I18nProvider initialLocale={locale}>
      <DataMigrationIssueNotice
        issue={issue}
        severity={severity}
        targetRoot={targetRoot}
      />
    </I18nProvider>,
  );
}
