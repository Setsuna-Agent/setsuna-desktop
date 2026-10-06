// @vitest-environment happy-dom
import type { SettingsViewUi } from '@setsuna-desktop/renderer-contracts/settings';
import { Button } from '@setsuna-desktop/renderer-ui';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DesktopUpdateState, UpdaterDesktopBridge } from '../../src/contracts/index.js';
import { UpdaterRendererStateService } from '../../src/renderer/service.js';
import { UpdaterSettingsView } from '../../src/renderer/UpdaterSettingsView.js';

const ui = {
  Button,
  Group: ({ children, title }) => <div>{title}{children}</div>,
  Row: ({ children, label }) => <div>{label}{children}</div>,
  Section: ({ children }) => <div>{children}</div>,
  SelectField: ({ children, disabled, onValueChange, value, 'aria-label': label }) => (
    <select aria-label={label} disabled={disabled} value={value} onChange={(event) => onValueChange(event.target.value)}>
      {children}
    </select>
  ),
} satisfies Partial<SettingsViewUi>;

const services: UpdaterRendererStateService[] = [];
afterEach(() => {
  cleanup();
  services.splice(0).forEach((service) => service.dispose());
});

function fixture(patch: Partial<DesktopUpdateState> = {}) {
  const state: DesktopUpdateState = {
    status: 'idle',
    currentVersion: '0.3.2',
    platform: 'darwin',
    arch: 'arm64',
    installMode: 'open-finder',
    canCheckForUpdates: true,
    canUpdate: false,
    feedUrl: 'https://github.com/Setsuna-Agent/setsuna-desktop/releases/latest',
    activeDownloadSourceId: 'github-direct',
    downloadSources: [{ id: 'github-direct', name: 'GitHub Direct', urlTemplate: '{url}', builtIn: true }],
    manualInstall: true,
    ...patch,
  };
  const bridge: UpdaterDesktopBridge = {
    getState: vi.fn(async () => state),
    onStateChange: vi.fn(() => () => undefined),
    checkForUpdates: vi.fn(),
    addDownloadSource: vi.fn(),
    selectDownloadSource: vi.fn(),
    removeDownloadSource: vi.fn(),
    quitAndInstall: vi.fn(),
  };
  const service = new UpdaterRendererStateService(bridge);
  services.push(service);
  render(
    <UpdaterSettingsView
      openExternal={vi.fn(async () => true)}
      platform="darwin"
      service={service}
      translate={(key) => key}
      ui={ui as SettingsViewUi}
    />,
  );
  return { bridge, service, state };
}

describe('manual update checks in settings', () => {
  it('allows development checks and another check after a new version is found', async () => {
    const { bridge, service, state } = fixture();
    let finishCheck!: (result: DesktopUpdateState) => void;
    const pending = new Promise<DesktopUpdateState>((resolve) => { finishCheck = resolve; });
    vi.mocked(bridge.checkForUpdates)
      .mockReturnValueOnce(pending)
      .mockResolvedValueOnce({ ...state, status: 'not-available' });
    await act(async () => service.start());

    const checkButton = screen.getByRole<HTMLButtonElement>('button', { name: 'feature.updater.settings.check' });
    expect(checkButton.disabled).toBe(false);
    fireEvent.click(checkButton);
    expect(bridge.checkForUpdates).toHaveBeenCalledOnce();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'feature.updater.settings.checking' }).disabled).toBe(true);

    await act(async () => finishCheck({ ...state, status: 'available', availableVersion: 'v0.4.0' }));
    const nextCheckButton = screen.getByRole<HTMLButtonElement>('button', { name: 'feature.updater.settings.check' });
    expect(nextCheckButton.disabled).toBe(false);
    fireEvent.click(nextCheckButton);
    await waitFor(() => expect(service.snapshot().state?.status).toBe('not-available'));
    expect(bridge.checkForUpdates).toHaveBeenCalledTimes(2);
    expect(bridge.quitAndInstall).not.toHaveBeenCalled();
  });

  it('keeps checks disabled when the host does not allow metadata access', async () => {
    const { bridge, service } = fixture({ canCheckForUpdates: false });
    await act(async () => service.start());
    const checkButton = screen.getByRole<HTMLButtonElement>('button', { name: 'feature.updater.settings.check' });
    expect(checkButton.disabled).toBe(true);
    fireEvent.click(checkButton);
    expect(bridge.checkForUpdates).not.toHaveBeenCalled();
  });
});
