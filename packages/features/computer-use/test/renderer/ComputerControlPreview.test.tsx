// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { IconButton } from '@setsuna-desktop/renderer-ui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComputerBridge, ComputerPreview } from '../../src/contracts/index.js';
import { ComputerControlPreview } from '../../src/renderer/ComputerControlPreview.js';

const previewLabel = 'feature.computerUse.preview';
const stopLabel = 'feature.computerUse.stop';
const preview: ComputerPreview = { active: true, frame: {
  dataUrl: 'data:image/png;base64,YWJj', width: 200, height: 100, observationId: 'first',
} };
beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

async function fixture() {
  let active = true;
  const bridge = {
    status: vi.fn(async () => ({ active })),
    preview: vi.fn(async (): Promise<ComputerPreview> => active ? preview : { active: false, frame: null }),
    stop: vi.fn(async () => { active = false; }),
    settings: vi.fn(), setEnabled: vi.fn(), requestPermission: vi.fn(),
  } satisfies ComputerBridge;
  await act(async () => {
    render(<><button>Other work</button><ComputerControlPreview bridge={bridge} ui={{ IconButton }} translate={(key) => key} /></>);
  });
  return bridge;
}
const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

describe('computer preview interaction', () => {
  it('reads images only on hover, preserves work focus and lets the pointer reach the stop button', async () => {
    const bridge = await fixture();
    await advance(1100);
    expect(bridge.preview).not.toHaveBeenCalled();
    const other = screen.getByRole('button', { name: 'Other work' });
    other.focus();
    const trigger = screen.getByRole('button', { name: previewLabel });
    fireEvent.pointerEnter(trigger);
    await advance(160);
    expect(bridge.preview).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(other);
    expect(bridge.stop).not.toHaveBeenCalled();
    const stop = screen.getByRole('button', { name: stopLabel });
    fireEvent.pointerLeave(trigger);
    fireEvent.pointerEnter(stop);
    await advance(250);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: stopLabel })); });
    expect(bridge.stop).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: previewLabel })).toBeNull();
  });

  it('opens on activation without stopping, dismisses with Escape and ignores a late preview after closing', async () => {
    const bridge = await fixture();
    let resolve!: (value: ComputerPreview) => void;
    bridge.preview.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const trigger = screen.getByRole('button', { name: previewLabel });
    trigger.focus();
    await act(async () => { fireEvent.click(trigger); });
    expect(bridge.stop).not.toHaveBeenCalled();
    const stop = screen.getByRole('button', { name: stopLabel });
    expect(document.activeElement).toBe(stop);
    fireEvent.keyDown(stop, { key: 'Escape' });
    await advance(10);
    expect(document.activeElement).toBe(trigger);
    await act(async () => { resolve(preview); });
    await advance(1100);
    expect(bridge.preview).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: stopLabel })).toBeNull();
    expect(bridge.stop).not.toHaveBeenCalled();
  });

  it('keeps stop failures retryable and does not let an in-flight preview revive a stopped session', async () => {
    const bridge = await fixture();
    bridge.stop.mockRejectedValueOnce(new Error('Stop failed'));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: previewLabel })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: stopLabel })); });
    expect(screen.getByRole('alert').textContent).toContain('Stop failed');
    const updated = { ...preview, frame: { ...preview.frame!, dataUrl: 'data:image/png;base64,ZGVm', observationId: 'second' } };
    bridge.preview.mockResolvedValueOnce(updated);
    await advance(1000);
    expect(screen.getByRole('img', { name: previewLabel }).getAttribute('src')).toBe(updated.frame.dataUrl);
    let resolve!: (value: ComputerPreview) => void;
    bridge.preview.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    await advance(1000);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: stopLabel }));
      fireEvent.click(screen.getByRole('button', { name: stopLabel }));
    });
    expect(bridge.stop).toHaveBeenCalledTimes(2);
    await act(async () => { resolve(preview); });
    expect(screen.queryByRole('button', { name: previewLabel })).toBeNull();
  });
});
