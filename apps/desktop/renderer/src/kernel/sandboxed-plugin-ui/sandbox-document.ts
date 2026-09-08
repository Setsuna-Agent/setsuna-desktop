import type { RuntimePluginUiData } from '@setsuna-desktop/contracts';
import type { RuntimeSandboxedUiSource } from '@setsuna-desktop/contracts';

export const SANDBOXED_UI_CHANNEL = 'setsuna.sandboxed-ui.v1' as const;

export type SandboxedUiInvokeMessage = Readonly<{
  type: 'invoke';
  requestId: string;
  actionId: string;
  payload: unknown;
}>;

export type SandboxedUiFrameMessage =
  | Readonly<{ type: 'ready' }>
  | Readonly<{ type: 'resize'; height: number }>
  | SandboxedUiInvokeMessage;

const SANDBOX_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  "connect-src 'none'",
  "navigate-to 'none'",
  "media-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const BASE_STYLE = `
:root {
  color-scheme: light;
  --setsuna-color-text: #242424;
  --setsuna-color-text-muted: #7d7d7d;
  --setsuna-color-surface: #ffffff;
  --setsuna-color-surface-muted: #f5f5f5;
  --setsuna-color-border: #eaeaea;
  --setsuna-color-accent: #242424;
  --setsuna-color-accent-text: #ffffff;
  --setsuna-color-danger: #dc2626;
  --setsuna-color-success: #16a34a;
  --setsuna-color-warning: #ea580c;
  --setsuna-font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
* { box-sizing: border-box; }
html, body {
  min-width: 0;
  margin: 0;
  padding: 0;
  background: transparent;
}
body {
  color: var(--setsuna-color-text);
  font-family: var(--setsuna-font-family);
}
`;

const BOOTSTRAP = `(() => {
  // Chromium does not apply connect-src to WebRTC. Lock the direct WebRTC
  // connection entry points before any untrusted Plugin markup is parsed.
  for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCIceTransport']) {
    Object.defineProperty(window, name, {
      configurable: false,
      enumerable: false,
      value: undefined,
      writable: false,
    });
  }
  const channel = ${JSON.stringify(SANDBOXED_UI_CHANNEL)};
  let sequence = 0;
  let snapshot = Object.freeze({ data: Object.freeze({}), context: Object.freeze({}) });
  let resolveReady;
  let didResolveReady = false;
  const ready = new Promise((resolve) => { resolveReady = resolve; });
  const listeners = new Set();
  const pending = new Map();
  const send = (message) => parent.postMessage({ channel, ...message }, '*');
  const applyTheme = (theme) => {
    if (!theme || typeof theme !== 'object') return;
    for (const [name, value] of Object.entries(theme.variables || {})) {
      if (name.startsWith('--setsuna-') && typeof value === 'string') {
        document.documentElement.style.setProperty(name, value);
      }
    }
    if (theme.colorScheme === 'dark' || theme.colorScheme === 'light') {
      document.documentElement.style.colorScheme = theme.colorScheme;
    }
  };
  window.addEventListener('message', (event) => {
    if (event.source !== parent || !event.data || event.data.channel !== channel) return;
    const message = event.data;
    if (message.type === 'snapshot') {
      snapshot = Object.freeze({
        data: message.data && typeof message.data === 'object' ? message.data : Object.freeze({}),
        context: message.context && typeof message.context === 'object' ? message.context : Object.freeze({}),
      });
      applyTheme(message.theme);
      if (!didResolveReady) {
        didResolveReady = true;
        resolveReady(snapshot);
      }
      for (const listener of [...listeners]) {
        try { listener(snapshot); } catch (error) { console.error(error); }
      }
      return;
    }
    if (message.type !== 'action-result' || typeof message.requestId !== 'string') return;
    const request = pending.get(message.requestId);
    if (!request) return;
    pending.delete(message.requestId);
    if (message.ok) request.resolve(Object.freeze({ status: 'completed' }));
    else request.reject(new Error(message.error || 'Host action failed.'));
  });
  const api = Object.freeze({
    ready,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('subscribe requires a function.');
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    invoke(actionId, payload = {}) {
      if (typeof actionId !== 'string' || !actionId) return Promise.reject(new Error('Invalid action id.'));
      const requestId = 'action_' + (++sequence);
      return new Promise((resolve, reject) => {
        pending.set(requestId, { resolve, reject });
        send({ type: 'invoke', requestId, actionId, payload });
      });
    },
  });
  Object.defineProperty(window, 'setsunaUI', {
    configurable: false,
    enumerable: true,
    value: api,
    writable: false,
  });
  let resizeFrame = 0;
  const reportSize = () => {
    resizeFrame = 0;
    const bodyHeight = document.body ? document.body.scrollHeight : 0;
    send({ type: 'resize', height: Math.ceil(Math.max(document.documentElement.scrollHeight, bodyHeight)) });
  };
  const scheduleSize = () => {
    if (!resizeFrame) resizeFrame = requestAnimationFrame(reportSize);
  };
  const startSizing = () => {
    new ResizeObserver(scheduleSize).observe(document.documentElement);
    scheduleSize();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startSizing, { once: true });
  else startSizing();
  send({ type: 'ready' });
})();`;

export function createSandboxedUiDocument(source: RuntimeSandboxedUiSource): string {
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(SANDBOX_CSP)}">`,
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<script>${BOOTSTRAP}</script>`,
    `<style>${BASE_STYLE}\n${escapeStyleSource(source.css)}</style>`,
    '</head><body>',
    source.html,
    `<script>${escapeScriptSource(source.js)}</script>`,
    '</body></html>',
  ].join('');
}

export function parseSandboxedUiFrameMessage(value: unknown): SandboxedUiFrameMessage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const message = value as Record<string, unknown>;
  if (message.channel !== SANDBOXED_UI_CHANNEL) return null;
  if (message.type === 'ready') return Object.freeze({ type: 'ready' });
  if (message.type === 'resize') {
    return typeof message.height === 'number' && Number.isFinite(message.height)
      ? Object.freeze({ type: 'resize', height: message.height })
      : null;
  }
  if (
    message.type !== 'invoke'
    || typeof message.requestId !== 'string'
    || message.requestId.length > 96
    || typeof message.actionId !== 'string'
    || message.actionId.length > 96
  ) return null;
  return Object.freeze({
    type: 'invoke',
    requestId: message.requestId,
    actionId: message.actionId,
    payload: message.payload,
  });
}

export type SandboxedUiSnapshot = Readonly<{
  data: RuntimePluginUiData;
  context: RuntimePluginUiData;
}>;

function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
}

function escapeScriptSource(value: string): string {
  return value.replace(/<\/script/giu, '<\\/script');
}

function escapeStyleSource(value: string): string {
  return value.replace(/<\/style/giu, '<\\/style');
}
