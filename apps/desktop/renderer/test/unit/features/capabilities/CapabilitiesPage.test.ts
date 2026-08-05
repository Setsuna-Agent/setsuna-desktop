import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  pluginActionError,
  shouldRenderCapabilitiesTabsInPage,
} from '../../../../src/features/capabilities/CapabilitiesPage.js';

describe('capabilities tabs placement', () => {
  it('moves the tabs into page content on Windows only', () => {
    expect(shouldRenderCapabilitiesTabsInPage('win32')).toBe(true);
    expect(shouldRenderCapabilitiesTabsInPage('darwin')).toBe(false);
    expect(shouldRenderCapabilitiesTabsInPage('linux')).toBe(false);
    expect(shouldRenderCapabilitiesTabsInPage('browser')).toBe(false);
  });
});

describe('pluginActionError', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the runtime failure detail instead of replacing it with a generic retry message', () => {
    vi.spyOn(console, 'error').mockImplementationOnce(() => undefined);

    expect(pluginActionError(
      new Error("EPERM: operation not permitted, rename 'staging' -> 'installed' (POST /v1/plugin-marketplace/audit/update)"),
      '更新插件失败，请重试。',
    )).toBe("更新插件失败：EPERM: operation not permitted, rename 'staging' -> 'installed'");
  });

  it('keeps concise user-facing messages for known marketplace failures', () => {
    vi.spyOn(console, 'error').mockImplementationOnce(() => undefined);

    expect(pluginActionError(new Error('Marketplace plugin not found: missing'), '安装插件失败，请重试。'))
      .toBe('这个插件已不在当前市场中，请刷新后重试。');
  });
});
