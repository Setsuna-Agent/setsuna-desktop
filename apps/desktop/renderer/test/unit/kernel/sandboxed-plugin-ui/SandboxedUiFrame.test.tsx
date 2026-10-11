// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import {
  createSandboxedUiDocument,
  parseSandboxedUiFrameMessage,
} from '../../../../src/kernel/sandboxed-plugin-ui/sandbox-document.js';

describe('SandboxedUiFrame', () => {
  it('prevents CSS from closing its style element', () => {
    const injectedCss = '</style><script>window.savedPeer = window.RTCPeerConnection</script><style>';
    const document = createSandboxedUiDocument({ html: '', css: injectedCss, js: '' });

    expect(document).not.toContain(injectedCss);
    expect(document).toContain('<\\/style><script>window.savedPeer = window.RTCPeerConnection</script><style>');
  });

  it('keeps the bridge protocol narrow and rejects malformed messages', () => {
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
