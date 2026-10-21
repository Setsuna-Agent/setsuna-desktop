// @vitest-environment happy-dom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UsageColumnSettings } from '../../src/renderer/usage/UsageColumnSettings.js';
import { useUsageRecordColumns } from '../../src/renderer/usage/useUsageRecordColumns.js';
import { usageView } from './support.js';

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });

function Preferences() {
  const { columns, saveColumns } = useUsageRecordColumns();
  return <UsageColumnSettings columns={columns} onSave={saveColumns} />;
}

describe('usage column preferences', () => {
  it('discards cancelled edits, persists applied choices, and refuses an empty selection', async () => {
    const user = userEvent.setup();
    const view = render(usageView(<Preferences />));
    await user.click(screen.getByRole('button', { name: '显示设置' }));
    await user.click(screen.getByRole('checkbox', { name: '耗时' }));
    await user.click(screen.getByRole('button', { name: '取消' }));
    await user.click(screen.getByRole('button', { name: '显示设置' }));
    expect((screen.getByRole('checkbox', { name: '耗时' }) as HTMLInputElement).checked).toBe(true);
    await user.click(screen.getByRole('checkbox', { name: '耗时' }));
    await user.click(screen.getByRole('checkbox', { name: '非缓存输入' }));
    await user.click(screen.getByRole('button', { name: '应用' }));
    view.unmount();

    render(usageView(<Preferences />));
    await user.click(screen.getByRole('button', { name: '显示设置' }));
    expect((screen.getByRole('checkbox', { name: '耗时' }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole('checkbox', { name: '非缓存输入' }) as HTMLInputElement).checked).toBe(true);
    for (const checkbox of screen.getAllByRole('checkbox')) {
      if ((checkbox as HTMLInputElement).checked) await user.click(checkbox);
    }
    expect((screen.getByRole('button', { name: '应用' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: '选择全部' }));
    expect(screen.getAllByRole('checkbox').every((node) => (node as HTMLInputElement).checked)).toBe(true);
  });

  it('retains the draft on a storage failure and applies it on retry', async () => {
    const user = userEvent.setup();
    render(usageView(<Preferences />));
    await user.click(screen.getByRole('button', { name: '显示设置' }));
    await user.click(screen.getByRole('checkbox', { name: '输出速度' }));
    const save = vi.spyOn(window.localStorage, 'setItem').mockImplementationOnce(() => { throw new Error('Quota exceeded'); });
    await user.click(screen.getByRole('button', { name: '应用' }));
    const dialog = screen.getByRole('dialog');
    expect((within(dialog).getByRole('checkbox', { name: '输出速度' }) as HTMLInputElement).checked).toBe(false);
    await user.click(within(dialog).getByRole('button', { name: '应用' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(save).toHaveBeenCalledTimes(2);
  });
});
