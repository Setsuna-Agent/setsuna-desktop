import {
  parseRuntimePluginUiData,
  type RuntimePluginUiData,
} from '@setsuna-desktop/contracts';
import type { SandboxedUiFrameProps } from '@setsuna-desktop/feature-ui-card/contracts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createSandboxedUiDocument,
  parseSandboxedUiFrameMessage,
  SANDBOXED_UI_CHANNEL,
} from './sandbox-document.js';
import './sandboxed-ui-frame.css';

const MIN_FRAME_HEIGHT = 96;
const MAX_FRAME_HEIGHT = 2_000;
const MAX_MESSAGES_PER_SECOND = 120;

export function SandboxedUiFrame({
  allowedActionIds = [],
  className,
  context = Object.freeze({}),
  data = Object.freeze({}),
  onAction,
  source,
  title,
}: SandboxedUiFrameProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const actionRunning = useRef(false);
  const messageBudget = useRef({ count: 0, startedAt: 0 });
  const [height, setHeight] = useState(240);
  const srcDoc = useMemo(() => createSandboxedUiDocument(source), [source]);
  const allowedActions = useMemo(() => new Set(allowedActionIds), [allowedActionIds]);

  const postToFrame = useCallback((message: Record<string, unknown>) => {
    frameRef.current?.contentWindow?.postMessage({ channel: SANDBOXED_UI_CHANNEL, ...message }, '*');
  }, []);
  const postSnapshot = useCallback(() => {
    postToFrame({
      type: 'snapshot',
      data,
      context,
      theme: hostThemeSnapshot(),
    });
  }, [context, data, postToFrame]);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow || !consumeMessageBudget(messageBudget.current)) return;
      const message = parseSandboxedUiFrameMessage(event.data);
      if (!message) return;
      if (message.type === 'ready') {
        postSnapshot();
        return;
      }
      if (message.type === 'resize') {
        setHeight(clamp(Math.ceil(message.height), MIN_FRAME_HEIGHT, MAX_FRAME_HEIGHT));
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
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [allowedActions, onAction, postSnapshot, postToFrame]);

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

  return (
    <iframe
      allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'"
      className={['sandboxed-ui-frame', className].filter(Boolean).join(' ')}
      onLoad={postSnapshot}
      ref={frameRef}
      referrerPolicy="no-referrer"
      sandbox="allow-scripts"
      srcDoc={srcDoc}
      style={{ height }}
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
    ['--setsuna-color-accent', '--app-primary'],
    ['--setsuna-color-accent-text', '--app-primary-text'],
    ['--setsuna-color-danger', '--app-danger'],
    ['--setsuna-color-success', '--app-success'],
    ['--setsuna-color-warning', '--app-warning'],
    ['--setsuna-font-family', '--app-font-family'],
  ].map(([target, source]) => [target, styles.getPropertyValue(source).trim()]).filter(([, value]) => value)));
  return Object.freeze({
    colorScheme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
    variables,
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
