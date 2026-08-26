// @vitest-environment happy-dom

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  RuntimeUsageRecord,
} from '@setsuna-desktop/contracts';
import type {
  RuntimeUsageBucket,
  RuntimeUsageQuery,
  RuntimeUsageResponse,
  UsageProviderDescriptor,
  UsageRendererStateService,
} from '../../src/contracts/index.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UsageSettings } from '../../src/renderer/usage/UsageSettings.js';
import { UsageRecentCalls } from '../../src/renderer/usage/UsageRecentCalls.js';
import { UsageSettingsView } from '../../src/renderer/UsageSettingsView.js';
import { usageTestTranslate, usageTestUi, usageView } from './support.js';

afterEach(cleanup);

describe('UsageSettings', () => {
  it('refreshes the all-time snapshot after Usage is invalidated', async () => {
    let totalTokens = 100;
    const query = vi.fn(async () => ({ providers: [], usage: usageResponse(totalTokens) }));
    const service = usageService(query);
    render(
      <UsageSettingsView
        host={{ BrandIcon: () => null, Tooltip: usageTestUi.Tooltip }}
        service={service}
        translate={usageTestTranslate}
        ui={usageTestUi}
      />,
    );

    expect((await screen.findAllByText('100')).length).toBeGreaterThan(0);
    const heading = screen.getByRole('heading', { name: '用量分析' });
    expect(heading.closest('header')?.contains(screen.getByRole('button', { name: '7d' }))).toBe(true);
    totalTokens = 200;
    act(() => service.invalidate('thread-1'));

    await waitFor(() => expect(query).toHaveBeenCalledTimes(2));
    expect((await screen.findAllByText('200')).length).toBeGreaterThan(0);
  });

  it('filters summary data while keeping the annual calendar global', async () => {
    const user = userEvent.setup();
    const query = vi.fn(async (input: RuntimeUsageQuery = {}) => ({
      providers: [],
      usage: input.from
        ? usageResponse(42)
        : usageResponse(100, [usageDay(localDateKey(new Date()), 100)]),
    }));
    const service = usageService(query);
    const { container } = render(
      <UsageSettingsView
        host={{ BrandIcon: () => null, Tooltip: usageTestUi.Tooltip }}
        service={service}
        translate={usageTestTranslate}
        ui={usageTestUi}
      />,
    );

    expect(await screen.findByText('1 个活跃日')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '7d' }));
    await waitFor(() => expect(query).toHaveBeenCalledTimes(2));
    const rangeQuery = query.mock.calls[1][0];
    expect(Date.parse(rangeQuery.to ?? '') - Date.parse(rangeQuery.from ?? '')).toBe(7 * 24 * 60 * 60 * 1000);
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

  it('keeps the base provider catalog when filtered queries omit it', async () => {
    const user = userEvent.setup();
    const BrandIcon = vi.fn(() => null);
    const provider: UsageProviderDescriptor = {
      id: 'provider-a',
      name: 'Provider A',
      provider: 'openai-compatible',
      baseUrl: 'https://provider.example.test/v1',
      models: [{ code: 'model-a', name: 'Model A' }],
    };
    const query = vi.fn(async (input: RuntimeUsageQuery = {}) => ({
      providers: input.from ? [] : [provider],
      usage: input.from
        ? usageResponse(42, [], [], [usageDay('Provider A', 42)])
        : usageResponse(100),
    }));
    render(
      <UsageSettingsView
        host={{ BrandIcon, Tooltip: usageTestUi.Tooltip }}
        service={usageService(query)}
        translate={usageTestTranslate}
        ui={usageTestUi}
      />,
    );

    await screen.findAllByText('100');
    await user.click(screen.getByRole('button', { name: '7d' }));
    await screen.findAllByText('42');

    const providerIconCall = BrandIcon.mock.calls.find(([props]) => props.name === 'Provider A');
    expect(providerIconCall?.[0].providers).toEqual([provider]);
  });

  it('keeps the last completed range when a newer request fails', async () => {
    const user = userEvent.setup();
    const firstRequest = deferred<RuntimeUsageResponse>();
    const secondRequest = deferred<RuntimeUsageResponse>();
    const onQueryUsage = vi.fn()
      .mockImplementationOnce(() => firstRequest.promise)
      .mockImplementationOnce(() => secondRequest.promise);
    render(
      usageView(
        <UsageSettings
          providers={[]}
          usage={usageResponse(100)}
          onQueryUsage={onQueryUsage}
        />
      ),
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
      usageView(
        <UsageRecentCalls
          providers={[]}
          query={{ from: '2026-08-01T00:00:00.000Z' }}
          records={firstPage}
          totalRecordCount={11}
          onQueryUsage={onQueryUsage}
        />
      ),
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
  byProvider: RuntimeUsageBucket[] = [],
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
      byProvider,
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

function usageService(
  query: UsageRendererStateService['query'],
): UsageRendererStateService {
  const invalidationListeners = new Set<(threadId: string) => void>();
  return {
    available: true,
    controller: () => ({
      dispose: () => undefined,
      start: () => undefined,
      refresh: () => undefined,
      snapshot: () => ({ usage: null, loading: false, error: null }),
      subscribe: () => () => undefined,
    }),
    invalidate: (threadId) => {
      for (const listener of invalidationListeners) listener(threadId);
    },
    query,
    subscribeInvalidation: (listener) => {
      invalidationListeners.add(listener);
      return () => invalidationListeners.delete(listener);
    },
  };
}
