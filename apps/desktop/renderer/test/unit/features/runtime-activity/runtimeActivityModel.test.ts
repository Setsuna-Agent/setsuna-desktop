import { describe, expect, it } from 'vitest';
import { translate } from '../../../../src/shared/i18n/I18nProvider.js';
import {
  formatRuntimeActivityDuration,
  resolveRuntimeActivityLoadView,
  runtimeActivityCanOpenThread,
  runtimeServiceCanOpenThread,
  singleLineActivityCommand,
} from '../../../../src/features/runtime-activity/runtimeActivityModel.js';

describe('runtime activity model', () => {
  it('distinguishes initial failures from loading and ready snapshots', () => {
    expect(resolveRuntimeActivityLoadView({ error: null, hasSnapshot: false, loading: true })).toBe('loading');
    expect(resolveRuntimeActivityLoadView({ error: 'offline', hasSnapshot: false, loading: false })).toBe('error');
    expect(resolveRuntimeActivityLoadView({ error: 'stale', hasSnapshot: true, loading: false })).toBe('ready');
  });

  it('formats bounded human-readable durations', () => {
    const now = Date.parse('2026-08-06T10:00:00.000Z');

    expect(formatRuntimeActivityDuration('2026-08-06T09:59:40.000Z', now, zh)).toBe('< 1 分钟');
    expect(formatRuntimeActivityDuration('2026-08-06T08:35:00.000Z', now, zh)).toBe('1 小时 25 分钟');
    expect(formatRuntimeActivityDuration('2026-08-04T07:00:00.000Z', now, zh)).toBe('2 天 3 小时');
    expect(formatRuntimeActivityDuration(null, now, zh)).toBe('—');
  });

  it('keeps service commands on a single readable line', () => {
    expect(singleLineActivityCommand('pnpm dev\n  --host 0.0.0.0', 'fallback')).toBe('pnpm dev --host 0.0.0.0');
    expect(singleLineActivityCommand('  \n ', 'fallback')).toBe('fallback');
  });

  it('keeps side activities visible without routing them into the primary chat', () => {
    expect(runtimeActivityCanOpenThread({ threadKind: 'regular' })).toBe(true);
    expect(runtimeActivityCanOpenThread({ threadKind: 'side' })).toBe(false);
    expect(runtimeServiceCanOpenThread({
      threadKind: 'regular',
      threadTitle: 'Dev server',
    })).toBe(true);
    expect(runtimeServiceCanOpenThread({
      threadKind: 'regular',
      threadTitle: null,
    })).toBe(false);
    expect(runtimeServiceCanOpenThread({
      threadKind: 'side',
      threadTitle: 'Side service',
    })).toBe(false);
  });
});

const zh = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) => (
  translate('zh-CN', key, params)
);
