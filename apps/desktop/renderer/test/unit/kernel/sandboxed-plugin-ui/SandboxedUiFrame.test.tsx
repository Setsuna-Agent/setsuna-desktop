// @vitest-environment happy-dom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SandboxedUiFrame } from '../../../../src/kernel/sandboxed-plugin-ui/SandboxedUiFrame.js';
import {
  createSandboxedUiDocument,
  parseSandboxedUiFrameMessage,
} from '../../../../src/kernel/sandboxed-plugin-ui/sandbox-document.js';

describe('SandboxedUiFrame', () => {
  it('runs free-form source only inside an opaque, network-disabled iframe', () => {
    render(
      <SandboxedUiFrame
        data={{ condition: '晴' }}
        source={{
          html: '<main class="weather">杭州</main>',
          css: '.weather { color: orange; }',
          js: 'document.querySelector(".weather").dataset.ready = "true";',
        }}
        title="杭州天气"
      />,
    );

    const frame = screen.getByTitle('杭州天气') as HTMLIFrameElement;
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin');
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(frame.srcdoc).toContain("connect-src 'none'");
    expect(frame.srcdoc).toContain("navigate-to 'none'");
    expect(frame.srcdoc).toContain("['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCIceTransport']");
    expect(frame.srcdoc).toContain('Object.defineProperty(window, name');
    expect(frame.srcdoc).toContain('background: transparent');
    expect(frame.srcdoc).toContain("Object.defineProperty(window, 'setsunaUI'");
    expect(frame.srcdoc).toContain('<main class="weather">杭州</main>');
    expect(frame.srcdoc).toContain('.weather { color: orange; }');
    expect(frame.srcdoc.indexOf("['RTCPeerConnection'")).toBeLessThan(
      frame.srcdoc.indexOf('<main class="weather">'),
    );
    expect(frame.srcdoc.indexOf("['RTCPeerConnection'")).toBeLessThan(
      frame.srcdoc.indexOf('<style>'),
    );
  });

  it('locks direct network APIs before CSS is parsed and prevents CSS from closing its style element', () => {
    const injectedCss = '</style><script>window.savedPeer = window.RTCPeerConnection</script><style>';
    const document = createSandboxedUiDocument({ html: '', css: injectedCss, js: '' });

    expect(document.indexOf("['RTCPeerConnection'")).toBeLessThan(document.indexOf('<style>'));
    expect(document).not.toContain(injectedCss);
    expect(document).toContain('<\\/style><script>window.savedPeer = window.RTCPeerConnection</script><style>');
  });

  it('keeps the bridge protocol narrow and rejects malformed messages', () => {
    const document = createSandboxedUiDocument({ html: '', css: '', js: '' });
    expect(document).toContain("default-src 'none'");
    expect(parseSandboxedUiFrameMessage({
      channel: 'setsuna.sandboxed-ui.v1',
      type: 'resize',
      height: 480,
    })).toEqual({ type: 'resize', height: 480 });
    expect(parseSandboxedUiFrameMessage({
      channel: 'setsuna.sandboxed-ui.v1',
      type: 'invoke',
      requestId: 'request_1',
      actionId: 'weather.refresh',
      payload: { city: '杭州' },
    })).toMatchObject({ type: 'invoke', actionId: 'weather.refresh' });
    expect(parseSandboxedUiFrameMessage({
      channel: 'wrong',
      type: 'invoke',
    })).toBeNull();
  });
});
