import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  capabilityCatalogTitle,
  capabilityTabIds,
  pluginActionError,
} from '../../../../src/features/capabilities/CapabilitiesPage.js';
import { shouldRenderCapabilitiesNavigationInPage } from '../../../../src/features/capabilities/capabilitiesLayout.js';

describe('capabilities tabs placement', () => {
  it('moves the tabs into page content on Windows only', () => {
    expect(shouldRenderCapabilitiesNavigationInPage('win32')).toBe(true);
    expect(shouldRenderCapabilitiesNavigationInPage('darwin')).toBe(false);
    expect(shouldRenderCapabilitiesNavigationInPage('linux')).toBe(false);
    expect(shouldRenderCapabilitiesNavigationInPage('browser')).toBe(false);
  });

  it('keeps hooks inside plugins instead of exposing a standalone directory', () => {
    expect(capabilityTabIds).toEqual(['plugins', 'skills', 'mcp']);
  });

  it('uses the active catalog name as the page title', () => {
    expect(capabilityCatalogTitle('plugins')).toBe('插件');
    expect(capabilityCatalogTitle('mcp')).toBe('MCP');
    expect(capabilityCatalogTitle('skills')).toBe('技能');
  });
});

describe('pluginActionError', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the runtime failure detail instead of replacing it with a generic retry message', () => {
    vi.spyOn(console, 'error').mockImplementationOnce(() => undefined);

    expect(pluginActionError(
      new Error("EPERM: operation not permitted, rename 'staging' -> 'installed' (POST /v1/features/plugin-management/marketplace/audit/update)"),
      '更新插件失败，请重试。',
    )).toBe("更新插件失败：EPERM: operation not permitted, rename 'staging' -> 'installed'");
  });

  it('keeps concise user-facing messages for known marketplace failures', () => {
    vi.spyOn(console, 'error').mockImplementationOnce(() => undefined);

    expect(pluginActionError(new Error('Marketplace plugin not found: missing'), '安装插件失败，请重试。'))
      .toBe('这个插件已不在当前市场中，请刷新后重试。');
  });
});
