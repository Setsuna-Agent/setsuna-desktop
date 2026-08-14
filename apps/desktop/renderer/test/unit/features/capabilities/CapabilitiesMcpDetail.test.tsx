// @vitest-environment happy-dom

import type { RuntimeMcpServer } from '@setsuna-desktop/contracts';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CapabilitiesMcpDetail } from '../../../../src/features/capabilities/mcp/CapabilitiesMcpDetail.js';
import { I18nProvider } from '../../../../src/shared/i18n/I18nProvider.js';

afterEach(cleanup);

describe('CapabilitiesMcpDetail', () => {
  it('keeps edit and delete in the detail action menu', async () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    renderMcpDetail({ onDelete, onEdit });

    await userEvent.click(screen.getByRole('button', { name: 'MCP 操作' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: '编辑' }));
    expect(onEdit).toHaveBeenCalledOnce();

    await userEvent.click(screen.getByRole('button', { name: 'MCP 操作' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: '删除' }));
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it('shows OAuth login in detail and keeps enable as the only switch', async () => {
    const onLogin = vi.fn();
    const onUpdate = vi.fn();
    renderMcpDetail({ onLogin, onUpdate });

    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    await userEvent.click(screen.getByRole('checkbox', { name: '启用' }));
    await userEvent.click(screen.getByRole('button', { name: '登录' }));

    expect(onUpdate).toHaveBeenCalledWith({ enabled: false });
    expect(onLogin).toHaveBeenCalledOnce();
  });

  it('shows useful MCP details without optional connection or tool-scope summaries', () => {
    renderMcpDetail();

    expect(screen.getByText('https://example.com/mcp')).toBeTruthy();
    expect(screen.getAllByText('30000 ms')).toHaveLength(3);
    expect(screen.getByText('search')).toBeTruthy();
    expect(screen.getByText('delete')).toBeTruthy();
    expect(screen.queryByText('请求头')).toBeNull();
    expect(screen.queryByText('允许的工具')).toBeNull();
    expect(screen.queryByText('禁用的工具')).toBeNull();
  });
});

function renderMcpDetail(overrides: Partial<{
  onDelete: () => void;
  onEdit: () => void;
  onLogin: () => void;
  onUpdate: (patch: Pick<RuntimeMcpServer, 'enabled'>) => void;
}> = {}) {
  render(
    <I18nProvider initialLocale="zh-CN">
      <CapabilitiesMcpDetail
        authPending={false}
        server={mcpServer}
        onBack={() => undefined}
        onDelete={overrides.onDelete ?? (() => undefined)}
        onEdit={overrides.onEdit ?? (() => undefined)}
        onLogin={overrides.onLogin ?? (() => undefined)}
        onLogout={() => undefined}
        onUpdate={overrides.onUpdate ?? (() => undefined)}
      />
    </I18nProvider>,
  );
}

const mcpServer: RuntimeMcpServer = {
  key: 'docs',
  label: 'Docs MCP',
  description: 'Search documentation.',
  transport: 'streamableHttp',
  args: [],
  url: 'https://example.com/mcp',
  timeoutMs: 30_000,
  startupTimeoutMs: 30_000,
  toolTimeoutMs: 30_000,
  enabled: true,
  allowedTools: ['search'],
  disabledTools: ['delete'],
  oauthClientId: 'client-id',
  oauthResource: 'https://resource.example.com',
  authStatus: 'notLoggedIn',
  tools: [{ name: 'search' }, { name: 'delete' }],
  envKeys: [],
  headerKeys: ['X-API-Key'],
  source: 'local',
  readOnly: false,
};
