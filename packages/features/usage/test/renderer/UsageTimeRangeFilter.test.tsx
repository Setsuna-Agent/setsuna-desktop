// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { usageMessages } from '../../src/renderer/messages.js';
import { UsageTimeRangeFilter } from '../../src/renderer/usage/UsageTimeRangeFilter.js';
import { UsageViewProvider } from '../../src/renderer/usage/view-context.js';
import { usageTestUi, usageView } from './support.js';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
  vi.setSystemTime(new Date(2026, 1, 1, 12, 20));
});

afterEach(() => { cleanup(); vi.useRealTimers(); });

function openRange() {
  const apply = vi.fn();
  render(usageView(<UsageTimeRangeFilter activeRange="all" error={null} loading={false}
    onApplyCustom={apply} onSelectPreset={() => undefined} />));
  fireEvent.click(screen.getByRole('button', { name: '自定义' }));
  return apply;
}

it.each([
  { now: new Date(2026, 1, 1, 12, 20), unit: '月', expectedFrom: '2026/02/28 12:20', expectedTo: '2026/03/01 12:20' },
  { now: new Date(2024, 2, 1, 12, 20), unit: '年', expectedFrom: '2025/02/28 12:20', expectedTo: '2025/03/01 12:20' },
])('keeps month-end dates editable when changing $unit', ({ now, unit, expectedFrom, expectedTo }) => {
  vi.setSystemTime(now);
  const apply = openRange();
  fireEvent.keyDown(screen.getByLabelText(`开始时间 ${unit}`), { key: 'ArrowDown' });
  expect(screen.getByLabelText('开始时间 日').getAttribute('aria-valuetext')).toBe('28');
  expect(screen.getAllByRole('listbox')).toHaveLength(10);
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  fireEvent.click(screen.getByRole('button', { name: '自定义' }));
  fireEvent.keyDown(screen.getByLabelText(`结束时间 ${unit}`), { key: 'ArrowDown' });
  fireEvent.click(screen.getByRole('button', { name: '应用筛选' }));

  expect(apply).toHaveBeenCalledExactlyOnceWith({ from: expectedFrom, to: expectedTo });
});

it.each([0, 800])('preserves changes across both bounds when applying after %i ms', (elapsed) => {
  const apply = openRange();
  // Keep these updates in one React batch so each patch must use the latest range.
  act(() => {
    fireEvent.keyDown(screen.getByLabelText('开始时间 时'), { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByLabelText('开始时间 分'), { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByLabelText('结束时间 时'), { key: 'ArrowDown' });
  });
  act(() => vi.advanceTimersByTime(elapsed));
  fireEvent.click(screen.getByRole('button', { name: '应用筛选' }));
  act(() => vi.advanceTimersByTime(800));

  expect(apply).toHaveBeenCalledExactlyOnceWith({ from: '2026/01/31 13:21', to: '2026/02/01 13:20' });
});

it('names every date and time wheel in the selected locale', () => {
  render(<UsageViewProvider host={{ BrandIcon: () => null, Tooltip: usageTestUi.Tooltip }} ui={usageTestUi}
    translate={(key) => usageMessages.messages['en-US']?.[key] ?? key}>
    <UsageTimeRangeFilter activeRange="all" error={null} loading={false}
      onApplyCustom={() => undefined} onSelectPreset={() => undefined} />
  </UsageViewProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Custom' }));

  for (const bound of ['Start time', 'End time']) {
    for (const unit of ['year', 'month', 'day', 'hour', 'minute']) {
      expect(screen.getByRole('listbox', { name: `${bound} ${unit}` })).toBeTruthy();
    }
  }
});
