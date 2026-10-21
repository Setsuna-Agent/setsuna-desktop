// @vitest-environment happy-dom

import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
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
  UsageSnapshot,
} from '../../src/contracts/index.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UsageSettings } from '../../src/renderer/usage/UsageSettings.js';
import { UsageRecentCalls } from '../../src/renderer/usage/UsageRecentCalls.js';
import { UsageSettingsView } from '../../src/renderer/UsageSettingsView.js';
import { useUsageSettingsData } from '../../src/renderer/useUsageSettingsData.js';
import { usageTestTranslate, usageTestUi, usageView } from './support.js';

afterEach(cleanup);

describe('usage settings requests', () => {
  it('cancels superseded loads and ignores late snapshots after refresh or unmount', async () => {
    const first = deferred<UsageSnapshot>();
    const second = deferred<UsageSnapshot>();
    const third = deferred<UsageSnapshot>();
    const query = vi.fn<UsageRendererStateService['query']>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockReturnValueOnce(third.promise);
    const service = usageService(query);
    const view = renderHook(() => useUsageSettingsData(service));
    expect(view.result.current.loading).toBe(true);
    expect(view.result.current.snapshot).toBeNull();

    act(() => service.invalidate('thread-1'));
    expect(query.mock.calls[0][1]?.signal?.aborted).toBe(true);
    const latest = { providers: [], usage: usageResponse(200) };
    await act(async () => second.resolve(latest));
    await act(async () => first.resolve({ providers: [], usage: usageResponse(100) }));
    expect(view.result.current.snapshot).toBe(latest);
    expect(view.result.current.loading).toBe(false);

    act(() => service.invalidate('thread-1'));
    expect(view.result.current.snapshot).toBe(latest);
    view.unmount();
    expect(query.mock.calls[2][1]?.signal?.aborted).toBe(true);
    await act(async () => third.resolve({ providers: [], usage: usageResponse(300) }));
    act(() => service.invalidate('thread-1'));
    expect(query).toHaveBeenCalledTimes(3);
  });

  it('recovers from initial failure and keeps the baseline during filtering and a failed refresh', async () => {
    const baseline = { providers: [], usage: usageResponse(100) };
    const filtered = { providers: [], usage: usageResponse(42) };
    const refreshed = { providers: [], usage: usageResponse(200) };
    const query = vi.fn<UsageRendererStateService['query']>()
      .mockRejectedValueOnce(new Error('Initial failure'))
      .mockResolvedValueOnce(baseline)
      .mockResolvedValueOnce(filtered)
      .mockRejectedValueOnce(new Error('Refresh failure'))
      .mockResolvedValueOnce(refreshed);
    const service = usageService(query);
    const view = renderHook(() => useUsageSettingsData(service));
    await waitFor(() => expect(view.result.current.error).toBe('Initial failure'));
    expect(view.result.current.snapshot).toBeNull();
    expect(view.result.current.loading).toBe(false);

    act(() => view.result.current.refresh());
    await waitFor(() => expect(view.result.current.snapshot).toBe(baseline));
    await act(async () => {
      expect(await view.result.current.query({ model: 'model-a' })).toBe(filtered.usage);
    });
    expect(view.result.current.snapshot).toBe(baseline);

    act(() => service.invalidate('thread-1'));
    await waitFor(() => expect(view.result.current.error).toBe('Refresh failure'));
    expect(view.result.current.snapshot).toBe(baseline);
    act(() => view.result.current.refresh());
    await waitFor(() => expect(view.result.current.snapshot).toBe(refreshed));
    expect(view.result.current.error).toBeNull();
  });
});

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
    expect(heading.closest('header')?.contains(screen.getByRole('combobox', { name: '统计时段' }))).toBe(true);
    totalTokens = 200;
    act(() => service.invalidate('thread-1'));

    await waitFor(() => expect(query).toHaveBeenCalledTimes(2));
    expect((await screen.findAllByText('200')).length).toBeGreaterThan(0);
  });

  it('combines time, provider and model filters while keeping the annual calendar global', async () => {
    const user = userEvent.setup();
    const query = vi.fn(async (input: RuntimeUsageQuery = {}) => ({
      providers: [],
      usage: Object.keys(input).length
        ? usageResponse(42)
        : usageResponse(100, [usageDay(localDateKey(new Date()), 100)], [], [usageDay('Provider A', 100)], [usageDay('model-a', 100)]),
    }));
    const service = usageService(query);
    render(
      <UsageSettingsView
        host={{ BrandIcon: () => null, Tooltip: usageTestUi.Tooltip }}
        service={service}
        translate={usageTestTranslate}
        ui={usageTestUi}
      />,
    );

    // 年度活跃统计基于全量数据：切换短时段后仍保持“1 天”活跃。
    const activeDays = () => screen.getByText('活跃天数').nextElementSibling?.textContent;
    await screen.findByText('活跃天数');
    expect(activeDays()).toBe('1 天');
    await user.selectOptions(screen.getByRole('combobox', { name: '统计时段' }), '4h');
    await waitFor(() => expect(query).toHaveBeenCalledTimes(2));
    const rangeQuery = query.mock.calls[1][0];
    expect(Date.parse(rangeQuery.to ?? '') - Date.parse(rangeQuery.from ?? '')).toBe(4 * 60 * 60 * 1000);
    expect((await screen.findAllByText('42')).length).toBeGreaterThan(0);
    expect(activeDays()).toBe('1 天');
    expect(screen.getAllByText('过去 4 小时').length).toBeGreaterThan(0);

    // 厂商与模型在已选时段上叠加；选项来自全量分桶，选中后其他选项仍可见。
    await user.selectOptions(screen.getByRole('combobox', { name: '厂商' }), 'Provider A');
    await user.selectOptions(screen.getByRole('combobox', { name: '模型' }), 'model-a');
    await waitFor(() => expect(query).toHaveBeenCalledTimes(4));
    expect(query.mock.calls[3][0]).toMatchObject({ provider: 'Provider A', model: 'model-a' });
    expect(query.mock.calls[3][0].from).toBeTruthy();

    // 全部清空后回到基线快照，最后一步不再发起查询。
    await user.selectOptions(screen.getByRole('combobox', { name: '统计时段' }), 'all');
    await user.selectOptions(screen.getByRole('combobox', { name: '厂商' }), '');
    await user.selectOptions(screen.getByRole('combobox', { name: '模型' }), '');
    expect((await screen.findAllByText('100')).length).toBeGreaterThan(0);
    expect(query).toHaveBeenCalledTimes(6);
  });

  it('combines selections made during pending requests and ignores stale results', async () => {
    const user = userEvent.setup();
    const rangeRequest = deferred<RuntimeUsageResponse>();
    const providerRequest = deferred<RuntimeUsageResponse>();
    const modelRequest = deferred<RuntimeUsageResponse>();
    const onQueryUsage = vi.fn<(query: RuntimeUsageQuery) => Promise<RuntimeUsageResponse>>()
      .mockImplementationOnce(() => rangeRequest.promise)
      .mockImplementationOnce(() => providerRequest.promise)
      .mockImplementationOnce(() => modelRequest.promise);
    render(usageView(
      <UsageSettings
        providers={[]}
        usage={usageResponse(100, [], [], [usageDay('Provider A', 100)], [usageDay('model-a', 100)])}
        onQueryUsage={onQueryUsage}
      />,
    ));

    await user.selectOptions(screen.getByRole('combobox', { name: '统计时段' }), '7d');
    await user.selectOptions(screen.getByRole('combobox', { name: '厂商' }), 'Provider A');
    await user.selectOptions(screen.getByRole('combobox', { name: '模型' }), 'model-a');

    expect(onQueryUsage).toHaveBeenCalledTimes(3);
    const query = onQueryUsage.mock.calls[2][0];
    expect(query).toMatchObject({ provider: 'Provider A', model: 'model-a' });
    expect(Date.parse(query.to ?? '') - Date.parse(query.from ?? '')).toBe(7 * 24 * 60 * 60 * 1000);

    await act(async () => modelRequest.resolve(usageResponse(42)));
    await act(async () => rangeRequest.resolve(usageResponse(64)));
    await act(async () => providerRequest.reject(new Error('stale request failed')));
    expect(screen.getAllByText('42').length).toBeGreaterThan(0);
    expect(screen.queryByText('64')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: '统计时段' }).value).toBe('7d');
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: '厂商' }).value).toBe('Provider A');
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: '模型' }).value).toBe('model-a');
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
    await user.selectOptions(screen.getByRole('combobox', { name: '统计时段' }), '7d');
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

    await user.selectOptions(screen.getByRole('combobox', { name: '统计时段' }), '7d');
    await user.selectOptions(screen.getByRole('combobox', { name: '统计时段' }), '30d');
    await act(async () => secondRequest.reject(new Error('request failed')));

    await screen.findByText('无法加载所选条件的用量，请稍后重试。');
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: '统计时段' }).value).toBe('all');
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

  it('navigates directly to distant pages and validates jumps without losing the current page on failure', async () => {
    const user = userEvent.setup();
    const onQueryUsage = vi.fn<(query: RuntimeUsageQuery) => Promise<RuntimeUsageResponse>>()
      .mockResolvedValueOnce(usageResponse(100, [], [usageRecord(10, 'last-page-model')]))
      .mockRejectedValueOnce(new Error('Page request failed'))
      .mockResolvedValueOnce(usageResponse(100, [], [usageRecord(41, 'page-forty-two-model')]));
    render(usageView(
      <UsageRecentCalls
        providers={[]}
        query={{ provider: 'provider-1', model: 'model-a' }}
        records={Array.from({ length: 10 }, (_, index) => usageRecord(index))}
        totalRecordCount={1307}
        onQueryUsage={onQueryUsage}
      />,
    ));

    await user.click(screen.getByRole('button', { name: '第 131 页' }));
    expect(await screen.findByText('last-page-model')).toBeTruthy();
    expect(onQueryUsage).toHaveBeenLastCalledWith({ provider: 'provider-1', model: 'model-a', limit: 10, offset: 1300 });

    const jumpInput = screen.getByRole<HTMLInputElement>('textbox', { name: '跳转页码' });
    for (const invalidPage of ['0', '132', '2.5', 'abc', '131']) {
      await user.clear(jumpInput);
      await user.type(jumpInput, `${invalidPage}{Enter}`);
    }
    expect(onQueryUsage).toHaveBeenCalledTimes(1);

    await user.clear(jumpInput);
    await user.type(jumpInput, '42{Enter}');
    expect(await screen.findByText('无法加载这一页，请重试。')).toBeTruthy();
    expect(screen.getByText('last-page-model')).toBeTruthy();
    expect(screen.getByRole('button', { name: '第 131 页', current: 'page' })).toBeTruthy();
    expect(jumpInput.value).toBe('42');

    await user.click(screen.getByRole('button', { name: '跳转', exact: true }));
    expect(await screen.findByText('page-forty-two-model')).toBeTruthy();
    expect(onQueryUsage).toHaveBeenCalledTimes(3);
    expect(onQueryUsage).toHaveBeenLastCalledWith({ provider: 'provider-1', model: 'model-a', limit: 10, offset: 410 });
    expect(screen.getByRole('button', { name: '第 42 页', current: 'page' })).toBeTruthy();
    expect(jumpInput.value).toBe('');
  });
});

function usageResponse(
  totalTokens: number,
  byDay: RuntimeUsageBucket[] = [],
  records: RuntimeUsageRecord[] = [],
  byProvider: RuntimeUsageBucket[] = [],
  byModel: RuntimeUsageBucket[] = [],
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
      byModel,
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
