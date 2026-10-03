import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComputerPermission } from '../../src/contracts/index.js';

const mocks = vi.hoisted(() => ({
  screen: vi.fn(() => 'denied'),
  accessibility: vi.fn((_prompt: boolean) => false),
  getSources: vi.fn(async () => []),
  openExternal: vi.fn(async (_url: string) => undefined),
}));
vi.mock('electron', () => ({
  systemPreferences: { getMediaAccessStatus: mocks.screen, isTrustedAccessibilityClient: mocks.accessibility },
  desktopCapturer: { getSources: mocks.getSources },
  shell: { openExternal: mocks.openExternal },
}));
import { computerPermissions, requestComputerPermission } from '../../src/main/permissions.js';

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
});
afterEach(() => vi.restoreAllMocks());

describe('desktop permission actions', () => {
  it('refreshes permission state without prompting or capturing the desktop', () => {
    expect(computerPermissions()).toEqual({ screen: 'denied', accessibility: 'denied' });
    mocks.screen.mockReturnValue('granted'); mocks.accessibility.mockReturnValue(true);
    expect(computerPermissions()).toEqual({ screen: 'granted', accessibility: 'granted' });
    expect(mocks.accessibility.mock.calls).toEqual([[false], [false]]);
    expect(mocks.getSources).not.toHaveBeenCalled(); expect(mocks.openExternal).not.toHaveBeenCalled();
  });

  it('requests accessibility and opens the exact permission pane when still untrusted', async () => {
    await requestComputerPermission('accessibility');
    expect(mocks.accessibility).toHaveBeenCalledWith(true);
    expect(mocks.openExternal).toHaveBeenCalledWith('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
    expect(mocks.getSources).not.toHaveBeenCalled();
  });

  it('uses a minimal screen request and finishes without opening settings when consent is granted', async () => {
    mocks.getSources.mockImplementationOnce(async () => { mocks.screen.mockReturnValue('granted'); return []; });
    await requestComputerPermission('screen');
    expect(mocks.getSources).toHaveBeenCalledWith({ types: ['screen'], thumbnailSize: { width: 1, height: 1 }, fetchWindowIcons: false });
    expect(mocks.openExternal).not.toHaveBeenCalled();
  });

  it('opens Screen Recording settings if the OS rejects the capture permission request', async () => {
    mocks.getSources.mockRejectedValueOnce(new Error('permission denied'));
    await requestComputerPermission('screen');
    expect(mocks.openExternal).toHaveBeenCalledWith('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
  });

  it('opens settings without attempting capture when system policy restricts screen access', async () => {
    mocks.screen.mockReturnValue('restricted');
    await requestComputerPermission('screen');
    expect(mocks.getSources).not.toHaveBeenCalled();
    expect(mocks.openExternal).toHaveBeenCalledOnce();
  });

  it('does not request access again when it is already granted', async () => {
    mocks.screen.mockReturnValue('granted'); mocks.accessibility.mockReturnValue(true);
    await requestComputerPermission('screen'); await requestComputerPermission('accessibility');
    expect(mocks.accessibility).not.toHaveBeenCalledWith(true);
    expect(mocks.getSources).not.toHaveBeenCalled(); expect(mocks.openExternal).not.toHaveBeenCalled();
  });

  it('does not invoke macOS permission APIs on Windows', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    expect(computerPermissions()).toEqual({ screen: 'unsupported', accessibility: 'unsupported', administrator: 'not-determined' });
    await requestComputerPermission('screen'); await requestComputerPermission('accessibility');
    expect(mocks.screen).not.toHaveBeenCalled(); expect(mocks.accessibility).not.toHaveBeenCalled();
    expect(mocks.getSources).not.toHaveBeenCalled(); expect(mocks.openExternal).not.toHaveBeenCalled();
  });

  it('rejects unrecognized IPC permission values before any system action', async () => {
    await expect(requestComputerPermission('https://example.com' as ComputerPermission)).rejects.toThrow('Invalid');
    expect(mocks.screen).not.toHaveBeenCalled(); expect(mocks.openExternal).not.toHaveBeenCalled();
  });
});
