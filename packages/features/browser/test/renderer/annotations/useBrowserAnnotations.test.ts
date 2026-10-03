// @vitest-environment happy-dom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeInlineMessageAttachment } from '@setsuna-desktop/contracts';
import type { BrowserAnnotationTarget, BrowserDesktopBridge, DesktopBrowserScreenshot } from '../../../src/contracts/index.js';
import { useBrowserAnnotations } from '../../../src/renderer/annotations/useBrowserAnnotations.js';
import { parseBrowserAnnotationMessage } from '../../../src/contracts/index.js';
import { translateBrowserMessage } from '../../../src/renderer/messages.js';

const target: BrowserAnnotationTarget = {
  id: '27f0b1c9-8c70-452e-8cce-2dd7e029f084',
  selector: '#submit', tag: 'button', text: 'Submit', url: 'https://example.com/', title: 'Checkout',
  bounds: { x: 1, y: 2, width: 30, height: 40 }, viewport: { width: 800, height: 600 }, styles: { color: 'red' },
};
const screenshot: DesktopBrowserScreenshot = {
  dataUrl: 'data:image/png;base64,b3JpZ2luYWw=', width: 1280, height: 720, mimeType: 'image/png', size: 8,
};
afterEach(cleanup);

function setup() {
  const bridge = {
    pickAnnotation: vi.fn(async (): Promise<BrowserAnnotationTarget | null> => null).mockResolvedValueOnce(target),
    cancelAnnotation: vi.fn(async () => undefined),
    setAnnotationMarkers: vi.fn(async () => true),
    captureAnnotationScreenshots: vi.fn(async (_tabId: string, ids: readonly string[]): Promise<DesktopBrowserScreenshot[] | null> => ids.map(() => screenshot)),
  };
  const onSend = vi.fn(async (_input: string, _screenshots: RuntimeInlineMessageAttachment[]) => true);
  const notify = vi.fn();
  const hook = renderHook(({ hidden, url }) => useBrowserAnnotations({
    bridge: bridge as unknown as BrowserDesktopBridge,
    tabId: 'tab-1', url, hidden, available: true, notify, onSend,
    translate: (key) => translateBrowserMessage('en-US', key),
  }), { initialProps: { hidden: false, url: target.url } });
  return { ...hook, bridge, notify, onSend };
}

describe('browser annotation workflow', () => {
  it('collects consecutive selections and sends the entire batch while waiting for another pick', async () => {
    const second = { ...target, id: '69a247d0-0ea1-4d87-9d27-701e850138ee', selector: '#heading' };
    const { result, bridge, onSend } = setup();
    bridge.pickAnnotation.mockResolvedValueOnce(second);
    const secondImage = { ...screenshot, dataUrl: 'data:image/png;base64,c2Vjb25k' };
    bridge.captureAnnotationScreenshots.mockResolvedValueOnce([screenshot, secondImage]);
    let complete: (value: BrowserAnnotationTarget) => void = () => undefined;
    bridge.pickAnnotation.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    await act(() => result.current.pick());
    act(() => result.current.setComment('First note'));
    await act(async () => result.current.save());
    expect(result.current.target).toEqual(second);
    expect(result.current.annotations).toEqual([{ target, comment: 'First note' }]);
    expect(bridge.setAnnotationMarkers).toHaveBeenLastCalledWith('tab-1', {
      ids: [target.id, second.id], activeId: second.id, visible: true,
    });
    act(() => result.current.setComment('Second note'));
    act(() => result.current.save());
    expect(result.current.picking).toBe(true);
    expect(result.current.canSend).toBe(true);
    expect(result.current.annotations).toHaveLength(2);
    await act(() => result.current.send());
    expect(parseBrowserAnnotationMessage(onSend.mock.calls[0][0])?.annotations).toEqual([
      { target, comment: 'First note' }, { target: second, comment: 'Second note' },
    ]);
    expect(bridge.captureAnnotationScreenshots).toHaveBeenCalledWith('tab-1', [target.id, second.id]);
    expect(onSend.mock.calls[0][1]).toHaveLength(2);
    expect(onSend.mock.calls[0][1].map((image) => image.url)).toEqual([screenshot.dataUrl, secondImage.dataUrl]);
    expect(onSend.mock.calls[0][1].map((image) => image.name)).toEqual([
      expect.stringMatching(/^browser-annotation-1-/), expect.stringMatching(/^browser-annotation-2-/),
    ]);
    await act(async () => complete({ ...target, id: 'late-selection' }));
    expect(result.current.target).toBeNull();
    expect(result.current.annotations).toEqual([
      { target, comment: 'First note' }, { target: second, comment: 'Second note' },
    ]);
    expect(bridge.setAnnotationMarkers).toHaveBeenLastCalledWith('tab-1', {
      ids: [target.id, second.id], activeId: null, visible: true,
    });
    expect(result.current.picking).toBe(false);
  });

  it('keeps draft and saved selections under the same identity until explicitly discarded or cleared', async () => {
    const { result, bridge } = setup();
    await act(() => result.current.pick());
    expect(bridge.setAnnotationMarkers).toHaveBeenLastCalledWith('tab-1', { ids: [target.id], activeId: target.id, visible: true });
    act(() => result.current.close());
    expect(result.current.target?.id).toBe(target.id);
    expect(bridge.setAnnotationMarkers).toHaveBeenLastCalledWith('tab-1', { ids: [target.id], activeId: target.id, visible: true });
    act(() => result.current.toggle());
    act(() => result.current.setComment('Retain this selection'));
    await act(async () => result.current.save());
    expect(bridge.setAnnotationMarkers).toHaveBeenLastCalledWith('tab-1', { ids: [target.id], activeId: null, visible: true });
    act(() => result.current.toggleMarkers());
    expect(result.current.annotations).toEqual([{ target, comment: 'Retain this selection' }]);
    expect(bridge.setAnnotationMarkers).toHaveBeenLastCalledWith('tab-1', { ids: [target.id], activeId: null, visible: false });
    act(() => result.current.clear());
    expect(result.current.annotations).toEqual([]);
    expect(result.current.open).toBe(true);
    expect(bridge.setAnnotationMarkers).toHaveBeenLastCalledWith('tab-1', { ids: [], activeId: null, visible: false });
    bridge.pickAnnotation.mockResolvedValueOnce(target);
    await act(() => result.current.pick());
    act(() => result.current.discard());
    expect(bridge.setAnnotationMarkers).toHaveBeenLastCalledWith('tab-1', { ids: [], activeId: null, visible: true });
  });

  it('saves the final allowed note and lets existing notes be edited without starting another pick', async () => {
    const { result, bridge, onSend } = setup();
    for (let index = 1; index < 20; index++) bridge.pickAnnotation.mockResolvedValueOnce({
      ...target, id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    });
    await act(() => result.current.pick());
    for (let index = 0; index < 20; index++) {
      act(() => result.current.setComment(`Note ${index + 1}`));
      await act(async () => result.current.save());
    }
    expect(result.current.annotations).toHaveLength(20);
    expect(result.current.target).toBeNull();
    expect(result.current.canPick).toBe(false);
    expect(result.current.canSend).toBe(true);
    act(() => result.current.edit(result.current.annotations[1]));
    act(() => result.current.setComment('Updated second note'));
    await act(async () => result.current.save());
    expect(bridge.pickAnnotation).toHaveBeenCalledTimes(20);
    await act(() => result.current.send());
    const sent = parseBrowserAnnotationMessage(onSend.mock.calls[0][0])!;
    expect(sent.annotations).toHaveLength(20);
    expect(sent.annotations[1].comment).toBe('Updated second note');
    expect(sent.annotations[19].comment).toBe('Note 20');
  });

  it('preserves drafts on failure and acknowledges successful sends without removing their markers', async () => {
    const { result, onSend } = setup();
    await act(() => result.current.pick());
    act(() => result.current.setComment('Move this button to the right'));
    let complete: (accepted: boolean) => void = () => undefined;
    onSend.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    let sending: Promise<void>;
    await act(async () => {
      sending = result.current.send();
      void result.current.send();
    });
    expect(onSend).toHaveBeenCalledOnce();
    expect(onSend.mock.calls[0][0]).toContain('Move this button to the right');
    expect(onSend.mock.calls[0][0]).toContain('browser-tab://tab-1');
    await act(async () => { complete(false); await sending; });
    expect(result.current.comment).toBe('Move this button to the right');
    expect(result.current.target).toEqual(target);
    await act(() => result.current.send());
    expect(result.current.annotations).toEqual([{ target, comment: 'Move this button to the right' }]);
    expect(result.current.target).toBeNull();
    expect(result.current.open).toBe(true);
    expect(result.current.canSend).toBe(false);
    await act(() => result.current.send());
    expect(onSend).toHaveBeenCalledTimes(2);
  });

  it('keeps the draft and does not send a partial message if the annotated screenshot fails', async () => {
    const { result, bridge, onSend, notify } = setup();
    await act(() => result.current.pick());
    act(() => result.current.setComment('Keep the original image'));
    bridge.captureAnnotationScreenshots.mockResolvedValueOnce(null).mockResolvedValueOnce([]);
    await act(() => result.current.send());
    await act(() => result.current.send());
    expect(onSend).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith('error', expect.any(String));
    expect(result.current.comment).toBe('Keep the original image');
    expect(result.current.target).toEqual(target);
    expect(result.current.canSend).toBe(true);
  });

  it('does not send a screenshot that completes after changing the page', async () => {
    const { result, bridge, onSend, rerender } = setup();
    await act(() => result.current.pick());
    act(() => result.current.setComment('Original page feedback'));
    let complete: (value: DesktopBrowserScreenshot[]) => void = () => undefined;
    bridge.captureAnnotationScreenshots.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    let sending: Promise<void>;
    act(() => { sending = result.current.send(); });
    expect(onSend).not.toHaveBeenCalled();
    act(() => result.current.clear());
    rerender({ hidden: false, url: 'https://example.com/another-page' });
    await act(async () => { complete([screenshot]); await sending; });
    expect(onSend).not.toHaveBeenCalled();
    expect(result.current.comment).toBe('');
    expect(result.current.annotations).toEqual([]);
    expect(result.current.canPick).toBe(true);
  });

  it('does not restore an old page batch when its send finishes after navigation', async () => {
    const { result, onSend, notify } = setup();
    await act(() => result.current.pick());
    act(() => result.current.setComment('Old page feedback'));
    let complete!: (accepted: boolean) => void;
    onSend.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    let sending!: Promise<void>;
    await act(async () => { sending = result.current.send(); });
    expect(onSend).toHaveBeenCalledOnce();
    act(() => result.current.clear());
    await act(async () => { complete(true); await sending; });
    expect(result.current.annotations).toEqual([]);
    expect(result.current.target).toBeNull();
    expect(result.current.comment).toBe('');
    expect(result.current.canPick).toBe(true);
    expect(notify).not.toHaveBeenCalled();
  });

  it('acknowledges a successful send while the same page is hidden', async () => {
    const { result, onSend, rerender } = setup();
    await act(() => result.current.pick());
    act(() => result.current.setComment('Keep this page note'));
    let complete!: (accepted: boolean) => void;
    onSend.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    let sending!: Promise<void>;
    await act(async () => { sending = result.current.send(); });
    rerender({ hidden: true, url: target.url });
    await act(async () => { complete(true); await sending; });
    rerender({ hidden: false, url: target.url });
    expect(result.current.annotations).toEqual([{ target, comment: 'Keep this page note' }]);
    expect(result.current.canSend).toBe(false);
    await act(() => result.current.send());
    expect(onSend).toHaveBeenCalledOnce();
  });

  it('reopens the original note when its element is picked again and keeps one marker when edited', async () => {
    const { result, bridge, onSend } = setup();
    await act(() => result.current.pick());
    act(() => result.current.setComment('Original feedback'));
    await act(() => result.current.send());
    bridge.pickAnnotation.mockResolvedValueOnce({ ...target, text: 'Updated page text' });
    await act(() => result.current.pick());
    expect(result.current.comment).toBe('Original feedback');
    expect(result.current.annotations).toHaveLength(1);
    expect(result.current.canSend).toBe(false);
    expect(bridge.setAnnotationMarkers).toHaveBeenLastCalledWith('tab-1', {
      ids: [target.id], activeId: target.id, visible: true,
    });
    act(() => result.current.setComment('Revised feedback'));
    await act(async () => result.current.save());
    expect(result.current.canSend).toBe(true);
    expect(result.current.annotations).toEqual([{
      target: { ...target, text: 'Updated page text' }, comment: 'Revised feedback',
    }]);
    await act(() => result.current.send());
    expect(parseBrowserAnnotationMessage(onSend.mock.calls[1][0])?.annotations).toHaveLength(1);
    expect(result.current.canSend).toBe(false);
    act(() => result.current.clear());
    expect(result.current.annotations).toEqual([]);
    expect(bridge.setAnnotationMarkers).toHaveBeenLastCalledWith('tab-1', { ids: [], activeId: null, visible: true });
  });

  it('discards late picks after switching tabs, but retains saved feedback with its original URL', async () => {
    const { result, bridge, rerender } = setup();
    await act(() => result.current.pick());
    act(() => result.current.setComment('Keep this feedback'));
    await act(async () => result.current.save());
    let complete: (value: BrowserAnnotationTarget) => void = () => undefined;
    bridge.pickAnnotation.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    let picking: Promise<void>;
    act(() => { picking = result.current.pick(); });
    rerender({ hidden: true, url: target.url });
    await act(async () => { complete({ ...target, id: 'late' }); await picking; });
    expect(result.current.target).toBeNull();
    expect(result.current.annotations).toEqual([{ target, comment: 'Keep this feedback' }]);
    expect(bridge.cancelAnnotation).toHaveBeenCalledWith('tab-1');
    expect(bridge.setAnnotationMarkers).toHaveBeenLastCalledWith('tab-1', { ids: [target.id], activeId: null, visible: false });
  });

  it('updates a saved comment rather than duplicating it when editing', async () => {
    const { result, onSend } = setup();
    await act(() => result.current.pick());
    act(() => result.current.setComment('First draft'));
    await act(async () => result.current.save());
    act(() => result.current.edit(result.current.annotations[0]));
    act(() => result.current.setComment('Final feedback'));
    await act(() => result.current.send());
    expect(onSend.mock.calls[0][0]).toContain('Final feedback');
    expect(onSend.mock.calls[0][0]).not.toContain('First draft');
    expect(parseBrowserAnnotationMessage(onSend.mock.calls[0][0])?.annotations).toHaveLength(1);
  });
});
