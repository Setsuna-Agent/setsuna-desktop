import {
  parseRuntimePluginUiData,
  type RuntimePluginUiData,
} from '@setsuna-desktop/contracts';
import type { SandboxedUiFrameProps } from '@setsuna-desktop/feature-ui-card/contracts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createSandboxedUiDocument,
  parseSandboxedUiFrameMessage,
  SANDBOXED_UI_FRAME_PERMISSIONS,
} from './sandbox-document.js';
import { SandboxedUiDocumentBridge } from './sandbox-document-bridge.js';
import './sandboxed-ui-frame.css';
import { useSandboxedRuntimeRequests } from './useSandboxedRuntimeRequests.js';
import { useSandboxDialogSession } from './useSandboxDialogSession.js';

const MIN_FRAME_HEIGHT = 96;
const MAX_FRAME_HEIGHT = 2_000;
const MAX_MESSAGES_PER_SECOND = 120;

export function SandboxedUiFrame({
  allowedActionIds = [],
  className,
  context = Object.freeze({}),
  data = Object.freeze({}),
  libraryScripts,
  onAction,
  onRuntimeRequest,
  size = 'content',
  source,
  title,
}: SandboxedUiFrameProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(240);
  const dialogs = useSandboxDialogSession(title);
  const libraryKey = useMemo(() => JSON.stringify(libraryScripts ?? []), [libraryScripts]);
  const bridge = useMemo(() => new SandboxedUiDocumentBridge(), [dialogs.url, libraryKey, size, source.css, source.html, source.js]);
  const actionRunning = useMemo(() => ({ current: false }), [bridge]);
  const messageBudget = useMemo(() => ({ count: 0, startedAt: 0 }), [bridge]);
  const srcDoc = useMemo(() => createSandboxedUiDocument(source, {
    libraryScripts, size, dialogUrl: dialogs.url, documentId: bridge.id,
  }), [bridge, dialogs.url, libraryScripts, size, source]);
  const allowedActions = useMemo(() => new Set(allowedActionIds), [allowedActionIds]);

  const postToFrame = useCallback((message: Record<string, unknown>) => {
    bridge.post(message);
  }, [bridge]);
  const requestRuntime = useSandboxedRuntimeRequests(onRuntimeRequest, postToFrame, bridge);
  const postSnapshot = useCallback(() => {
    postToFrame({
      type: 'snapshot',
      data,
      context,
      theme: hostThemeSnapshot(),
    });
  }, [context, data, postToFrame]);

  useEffect(() => {
    bridge.start();
    const connect = (event: MessageEvent) => bridge.connect(event, frameRef.current?.contentWindow);
    window.addEventListener('message', connect);
    return () => { window.removeEventListener('message', connect); bridge.revoke(); };
  }, [bridge]);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (!consumeMessageBudget(messageBudget)) return;
      const message = parseSandboxedUiFrameMessage(event.data);
      if (!message) return;
      if (message.type === 'ready') {
        postSnapshot();
        return;
      }
      if (message.type === 'resize') {
        if (size === 'content') setHeight(clamp(Math.ceil(message.height), MIN_FRAME_HEIGHT, MAX_FRAME_HEIGHT));
        return;
      }
      if (message.type === 'runtime-request') {
        requestRuntime(message.requestId, message.request);
        return;
      }
      if (!onAction || !allowedActions.has(message.actionId)) {
        postToFrame({
          type: 'action-result',
          requestId: message.requestId,
          ok: false,
          error: 'Host action is not available.',
        });
        return;
      }
      if (actionRunning.current) {
        postToFrame({
          type: 'action-result',
          requestId: message.requestId,
          ok: false,
          error: 'Another host action is running.',
        });
        return;
      }
      let payload: RuntimePluginUiData;
      try {
        payload = parseRuntimePluginUiData(message.payload ?? {});
      } catch {
        postToFrame({
          type: 'action-result',
          requestId: message.requestId,
          ok: false,
          error: 'Host action payload is invalid.',
        });
        return;
      }
      actionRunning.current = true;
      void onAction(message.actionId, payload).then(
        () => postToFrame({ type: 'action-result', requestId: message.requestId, ok: true }),
        () => postToFrame({
          type: 'action-result',
          requestId: message.requestId,
          ok: false,
          error: 'Host action failed.',
        }),
      ).finally(() => {
        actionRunning.current = false;
      });
    };
    return bridge.listen(receive);
  }, [actionRunning, allowedActions, bridge, messageBudget, onAction, postSnapshot, postToFrame, requestRuntime, size]);

  useEffect(() => {
    postSnapshot();
  }, [postSnapshot]);

  useEffect(() => {
    const observer = new MutationObserver(postSnapshot);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme', 'style'],
    });
    return () => observer.disconnect();
  }, [postSnapshot]);

  if (dialogs.error) return <div role="alert">{dialogs.error}</div>;
  if (!dialogs.ready) return null;
  return (
    <iframe
      allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'"
      className={['sandboxed-ui-frame', size === 'fill' && 'sandboxed-ui-frame--fill', className].filter(Boolean).join(' ')}
      key={bridge.id}
      onLoad={() => bridge.onLoad()}
      ref={frameRef}
      referrerPolicy="no-referrer"
      sandbox={SANDBOXED_UI_FRAME_PERMISSIONS}
      srcDoc={srcDoc}
      style={size === 'content' ? { height } : undefined}
      title={title}
    />
  );
}

function consumeMessageBudget(budget: { count: number; startedAt: number }): boolean {
  const now = performance.now();
  if (now - budget.startedAt >= 1_000) {
    budget.startedAt = now;
    budget.count = 0;
  }
  budget.count += 1;
  return budget.count <= MAX_MESSAGES_PER_SECOND;
}

function hostThemeSnapshot(): Readonly<{
  colorScheme: 'dark' | 'light';
  variables: Readonly<Record<string, string>>;
}> {
  const styles = getComputedStyle(document.documentElement);
  const variables = Object.freeze(Object.fromEntries([
    ['--setsuna-color-text', '--app-text'],
    ['--setsuna-color-text-muted', '--app-text-muted'],
    ['--setsuna-color-surface', '--app-surface'],
    ['--setsuna-color-surface-muted', '--app-surface-muted'],
    ['--setsuna-color-border', '--app-border'],
    ['--setsuna-color-border-strong', '--app-border-strong'],
    ['--setsuna-color-accent', '--app-primary'],
    ['--setsuna-color-accent-hover', '--app-primary-hover'],
    ['--setsuna-color-accent-text', '--app-primary-text'],
    ['--setsuna-color-danger', '--app-danger'],
    ['--setsuna-color-success', '--app-success'],
    ['--setsuna-color-warning', '--app-warning'],
    ['--setsuna-font-family', '--app-font-family'],
    ['--setsuna-radius-control', '--app-radius-control'],
    ['--setsuna-radius-field', '--app-radius-sm'],
  ].map(([target, source]) => [target, styles.getPropertyValue(source).trim()]).filter(([, value]) => value)));
  return Object.freeze({
    colorScheme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
    variables,
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
