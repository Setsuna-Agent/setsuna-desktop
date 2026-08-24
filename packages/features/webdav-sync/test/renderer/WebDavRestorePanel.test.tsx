// @vitest-environment happy-dom

import type {
  DesktopWebDavSyncOperationState,
  DesktopWebDavSyncRestorePlan,
  DesktopWebDavSyncSnapshotSummary,
} from '../../src/contracts/index.js';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebDavRestorePanel } from '../../src/renderer/WebDavRestorePanel.js';
import { TestWebDavSyncView } from '../support/renderer-view.js';

afterEach(cleanup);

describe('WebDavRestorePanel', () => {
  it('shows backup sizes without presenting internal files as domain item counts', () => {
    renderRestorePanel();

    expect(screen.getByText('3 类数据 · 896 B')).toBeTruthy();
    expect(screen.getByText('备份大小 512 B')).toBeTruthy();
    expect(screen.queryByText(/6 项/u)).toBeNull();
  });

  it('shows exact overwritten and removed items before enabling restore', async () => {
    const user = userEvent.setup();
    const onInspect = vi.fn(async () => restorePlan);
    const onRestore = vi.fn(async () => undefined);
    renderRestorePanel({ onInspect, onRestore });

    await user.click(screen.getByRole('button', { name: '检查会覆盖什么' }));

    const dialog = await screen.findByRole('dialog', { name: '还原覆盖清单' });
    expect(dialog.className).toContain('desktop-agent-modal');
    expect(await screen.findByText('本地 Agent 偏好')).toBeTruthy();
    expect(screen.getByText('仅本机 Skill')).toBeTruthy();
    expect(screen.getByText('其余 1 个类别不会造成本地覆盖或删除')).toBeTruthy();
    expect(within(dialog).getByText('长期记忆')).toBeTruthy();
    expect(within(dialog).queryByText('无')).toBeNull();
    expect(screen.getByText(/^本次会覆盖 1 项、删除 1 项本地内容/u)).toBeTruthy();
    const restoreButton = screen.getByRole('button', { name: '还原并重启' });
    expect((restoreButton as HTMLButtonElement).disabled).toBe(true);

    await user.click(screen.getByRole('checkbox', { name: /我已检查清单/u }));
    expect((restoreButton as HTMLButtonElement).disabled).toBe(false);
    await user.click(restoreButton);

    expect(onInspect).toHaveBeenCalledWith(snapshot.id, ['preferences', 'user_skills', 'memories']);
    expect(onRestore).toHaveBeenCalledWith(restorePlan.id);
    expect(screen.getByRole('status').textContent).toContain('正在开始还原');
    expect(screen.getByRole('button', { name: '还原中…' })).toBeTruthy();
  });

  it('keeps restore failures visible beside the restore action', async () => {
    const user = userEvent.setup();
    renderRestorePanel({
      onRestore: async () => {
        throw new Error('检查清单后，会被覆盖或删除的本地内容发生了变化，请重新检查。');
      },
    });

    await user.click(screen.getByRole('button', { name: '检查会覆盖什么' }));
    const dialog = await screen.findByRole('dialog', { name: '还原覆盖清单' });
    await user.click(within(dialog).getByRole('checkbox', { name: /我已检查清单/u }));
    await user.click(within(dialog).getByRole('button', { name: '还原并重启' }));

    const error = await within(dialog).findByRole('alert');
    expect(error.textContent).toContain('会被覆盖或删除的本地内容发生了变化');
    expect(within(dialog).getByRole('button', { name: '还原并重启' })).toBeTruthy();
  });

  it('shows live byte and percentage progress while downloading the restore', async () => {
    const user = userEvent.setup();
    const restoreOperation: DesktopWebDavSyncOperationState = {
      kind: 'restore',
      phase: 'downloading',
      startedAt: '2026-08-10T10:31:00.000Z',
      completedBytes: 384,
      totalBytes: 512,
      completedItems: 1,
      totalItems: 2,
      cancellable: true,
    };
    renderRestorePanel({ restoreOperation });

    await user.click(screen.getByRole('button', { name: '检查会覆盖什么' }));
    const dialog = await screen.findByRole('dialog', { name: '还原覆盖清单' });
    await user.click(within(dialog).getByRole('checkbox', { name: /我已检查清单/u }));
    await user.click(within(dialog).getByRole('button', { name: '还原并重启' }));

    const progress = within(dialog).getByRole('progressbar', { name: '正在下载加密对象…' });
    expect(progress.getAttribute('aria-valuenow')).toBe('75');
    expect(within(dialog).getByText('75%')).toBeTruthy();
    expect(within(dialog).getByText('384 B / 512 B')).toBeTruthy();
  });
});

type RestorePanelProps = ComponentProps<typeof WebDavRestorePanel>;

function renderRestorePanel(overrides: Partial<RestorePanelProps> = {}) {
  return render(
    <TestWebDavSyncView>
      <WebDavRestorePanel
        backup={snapshot}
        busy={false}
        onInspect={async () => restorePlan}
        onRefresh={async () => undefined}
        onRestore={async () => undefined}
        {...overrides}
      />
    </TestWebDavSyncView>,
  );
}

const snapshot: DesktopWebDavSyncSnapshotSummary = {
  id: '20260810T102030123Z-1234abcd',
  deviceId: '55bc8840-ac7a-435a-b5a7-88c2e91e7d87',
  deviceName: '工作电脑',
  createdAt: '2026-08-10T10:20:30.123Z',
  appVersion: '0.2.1',
  categories: [
    { id: 'preferences', itemCount: 1, totalBytes: 128 },
    { id: 'user_skills', itemCount: 1, totalBytes: 256 },
    { id: 'memories', itemCount: 6, totalBytes: 512 },
  ],
  totalBytes: 896,
};

const restorePlan: DesktopWebDavSyncRestorePlan = {
  id: 'plan-1',
  snapshot,
  categories: ['preferences', 'user_skills', 'memories'],
  createdAt: '2026-08-10T10:30:00.000Z',
  expiresAt: '2026-08-10T10:40:00.000Z',
      overwrittenCount: 1,
      removedCount: 1,
      projectActions: [],
  diffs: [
    {
      category: 'preferences',
      backupItemCount: 1,
      localItemCount: 1,
      added: [],
      overwritten: [{ id: 'runtime/config.json', label: '本地 Agent 偏好', detail: 'runtime/config.json' }],
      removed: [],
      preserved: [],
      addedCount: 0,
      overwrittenCount: 1,
      removedCount: 0,
      preservedCount: 0,
      warnings: [],
    },
    {
      category: 'user_skills',
      backupItemCount: 0,
      localItemCount: 1,
      added: [],
      overwritten: [],
      removed: [{
        id: 'runtime/user-skills/local/SKILL.md',
        label: '仅本机 Skill',
        detail: 'runtime/user-skills/local/SKILL.md',
      }],
      preserved: [],
      addedCount: 0,
      overwrittenCount: 0,
      removedCount: 1,
      preservedCount: 0,
      warnings: [],
    },
    {
      category: 'memories',
      backupItemCount: 6,
      localItemCount: 6,
      added: [],
      overwritten: [],
      removed: [],
      preserved: [],
      addedCount: 0,
      overwrittenCount: 0,
      removedCount: 0,
      preservedCount: 6,
      warnings: [],
    },
  ],
};
