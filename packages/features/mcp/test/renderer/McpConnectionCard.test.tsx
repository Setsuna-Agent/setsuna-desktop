// @vitest-environment happy-dom

import type { RuntimeMcpServer } from '@setsuna-desktop/contracts';
import type { SettingsDialogProps, SettingsViewUi } from '@setsuna-desktop/renderer-contracts/settings';
import { Button, Dialog, IconButton } from '@setsuna-desktop/renderer-ui';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpConnectionCard } from '../../src/renderer/McpConnectionCard.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const server: RuntimeMcpServer = {
  key: 'github', label: 'github', transport: 'streamableHttp', url: 'https://api.githubcopilot.com/mcp/',
  args: [], allowedTools: [], disabledTools: [], tools: [], envKeys: [], headerKeys: [],
  authStatus: 'oAuth', source: 'local', readOnly: false, enabled: true,
  timeoutMs: 120_000, startupTimeoutMs: 120_000, toolTimeoutMs: 120_000,
};
const ui = {
  Button, IconButton,
  Dialog: ({ children, title, closeLabel, onClose }: SettingsDialogProps) => (
    <Dialog title={title} closeLabel={closeLabel} onClose={onClose}>{children}</Dialog>
  ),
} as SettingsViewUi;

describe('McpConnectionCard', () => {
  it('offers reconnect and disconnect from the connected status menu', async () => {
    const onLogin = vi.fn(async () => undefined);
    const onLogout = vi.fn(async () => undefined);
    render(<McpConnectionCard server={server} onLogin={onLogin} onLogout={onLogout} onCancel={() => undefined}
      onEdit={() => undefined} openExternal={async () => true} translate={(key) => key} ui={ui} />);
    const trigger = screen.getByRole('button', { name: 'GitHub · feature.mcp.connection.connected' });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'feature.mcp.connection.reconnect' }));
    expect(onLogin).toHaveBeenCalledOnce();
    expect(onLogout).not.toHaveBeenCalled();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'feature.mcp.connection.disconnect' }));
    expect(onLogout).toHaveBeenCalledOnce();
  });

  it('keeps authorization in a dismissible dialog and waits for the user to copy and open', async () => {
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    const openExternal = vi.fn(async () => true);
    const onCancel = vi.fn();
    const props = {
      server: { ...server, authStatus: 'oAuthLoggingIn' as const },
      onLogin: async () => undefined, onLogout: async () => undefined,
      onEdit: () => undefined, onCancel, openExternal, translate: (key: string) => key, ui,
    };
    const { container, rerender } = render(<McpConnectionCard {...props} authAction="login" />);
    const dialog = await screen.findByRole('dialog');
    expect(container.contains(dialog)).toBe(false);
    const challenge = { userCode: 'ABCD-EFGH', verificationUri: 'https://github.com/login/device', expiresAt: '2026-09-13T12:00:00Z' };
    rerender(<McpConnectionCard {...props} server={{ ...props.server, deviceAuthorization: challenge }} authAction="login" />);
    expect(screen.getByRole('dialog')).toBe(dialog);
    expect(within(dialog).getByText(challenge.userCode)).toBeTruthy();
    expect(write).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'feature.mcp.device.open' }));
    await waitFor(() => expect(openExternal).toHaveBeenCalledExactlyOnceWith(challenge.verificationUri));
    expect(write).toHaveBeenCalledExactlyOnceWith(challenge.userCode);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledOnce();
    rerender(<McpConnectionCard {...props} server={server} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
