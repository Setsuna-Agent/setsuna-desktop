// @vitest-environment happy-dom

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  RuntimeUsageBucket,
  RuntimeUsageQuery,
  RuntimeUsageRecord,
  RuntimeUsageResponse,
} from '@setsuna-desktop/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UsageSettings } from '../../../../../src/features/settings/usage/UsageSettings.js';
import { UsageRecentCalls } from '../../../../../src/features/settings/usage/UsageRecentCalls.js';
import { I18nProvider } from '../../../../../src/shared/i18n/I18nProvider.js';

afterEach(cleanup);

describe('UsageSettings', () => {
  it('filters summary data while keeping the annual calendar global', async () => {
    const user = userEvent.setup();
    const onQueryUsage = vi.fn(async (_query: RuntimeUsageQuery) => usageResponse(42));
    const { container } = render(
      <I18nProvider initialLocale="zh-CN">
        <UsageSettings
          providers={[]}
          usage={usageResponse(100, [usageDay(localDateKey(new Date()), 100)])}
          onQueryUsage={onQueryUsage}
        />
      </I18nProvider>,
    );

    expect(screen.getByText('1 个活跃日')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '7d' }));
    await waitFor(() => expect(onQueryUsage).toHaveBeenCalledOnce());
    const query = onQueryUsage.mock.calls[0][0];
    expect(Date.parse(query.to ?? '') - Date.parse(query.from ?? '')).toBe(7 * 24 * 60 * 60 * 1000);
    expect((await screen.findAllByText('42')).length).toBeGreaterThan(0);
    expect(screen.getByText('1 个活跃日')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '自定义' }));
    const fromInput = await screen.findByLabelText('开始时间');
    const toInput = screen.getByLabelText('结束时间');
    expect((fromInput as HTMLInputElement).type).toBe('text');
    expect((fromInput as HTMLInputElement).value).toMatch(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/u);
    expect((toInput as HTMLInputElement).type).toBe('text');
    expect((toInput as HTMLInputElement).value).toMatch(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/u);
    expect(screen.getByLabelText('统计时段').querySelector('input')).toBeNull();
    expect(container.querySelector('input[type="datetime-local"]')).toBeNull();
    expect(screen.getByText('过去一年的每日消耗')).toBeTruthy();
  });

  it('keeps the last completed range when a newer request fails', async () => {
    const user = userEvent.setup();
    const firstRequest = deferred<RuntimeUsageResponse>();
    const secondRequest = deferred<RuntimeUsageResponse>();
    const onQueryUsage = vi.fn()
      .mockImplementationOnce(() => firstRequest.promise)
      .mockImplementationOnce(() => secondRequest.promise);
    render(
      <I18nProvider initialLocale="zh-CN">
        <UsageSettings
          providers={[]}
          usage={usageResponse(100)}
          onQueryUsage={onQueryUsage}
        />
      </I18nProvider>,
    );

    await user.click(screen.getByRole('button', { name: '7d' }));
    await user.click(screen.getByRole('button', { name: '30d' }));
    await act(async () => secondRequest.reject(new Error('request failed')));

    await screen.findByText('无法加载所选时段的用量，请稍后重试。');
    expect(screen.getByRole('button', { name: '全部时间' }).getAttribute('aria-pressed')).toBe('true');
    await act(async () => firstRequest.resolve(usageResponse(42)));
    expect(onQueryUsage).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('42')).toBeNull();
  });

  it('loads the requested records page with a server-side offset', async () => {
    const user = userEvent.setup();
    const firstPage = Array.from({ length: 10 }, (_, index) => usageRecord(index));
    const secondPageRecord = usageRecord(10, 'page-two-model');
    const onQueryUsage = vi.fn(async (_query: RuntimeUsageQuery) => (
      usageResponse(11, [], [secondPageRecord])
    ));
    render(
      <I18nProvider initialLocale="zh-CN">
        <UsageRecentCalls
          providers={[]}
          query={{ from: '2026-08-01T00:00:00.000Z' }}
          records={firstPage}
          totalRecordCount={11}
          onQueryUsage={onQueryUsage}
        />
      </I18nProvider>,
    );

    expect(screen.getByText('1 / 2')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '下一页' }));

    await waitFor(() => expect(onQueryUsage).toHaveBeenCalledWith({
      from: '2026-08-01T00:00:00.000Z',
      limit: 10,
      offset: 10,
    }));
    expect(await screen.findByText('page-two-model')).toBeTruthy();
    expect(screen.getByText('2 / 2')).toBeTruthy();
  });
});

function usageResponse(
  totalTokens: number,
  byDay: RuntimeUsageBucket[] = [],
  records: RuntimeUsageRecord[] = [],
): RuntimeUsageResponse {
  return {
    records,
    summary: {
      inputTokens: totalTokens,
      cachedInputTokens: 0,
      outputTokens: 0,
      totalTokens,
      recordCount: 1,
      byDay,
      byProvider: [],
      byModel: [],
    },
  };
}

function usageRecord(index: number, model = `model-${index}`): RuntimeUsageRecord {
  return {
    id: `usage-${index}`,
    threadId: 'thread-1',
    turnId: `turn-${index}`,
    createdAt: `2026-08-13T00:00:${String(index).padStart(2, '0')}.000Z`,
    model,
    provider: 'provider-1',
    totalTokens: index + 1,
  };
}

function usageDay(key: string, totalTokens: number): RuntimeUsageBucket {
  return {
    key,
    inputTokens: totalTokens,
    cachedInputTokens: 0,
    outputTokens: 0,
    totalTokens,
    recordCount: 1,
  };
}

function localDateKey(value: Date): string {
  const year = String(value.getFullYear());
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}
