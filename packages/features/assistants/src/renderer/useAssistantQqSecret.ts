import { useEffect, useRef, useState } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import type { AssistantsClient } from './client.js';

export type AssistantQqSecretOptions = {
  assistantId?: string;
  configured: boolean;
  value: string;
  client: Pick<AssistantsClient, 'revealQqSecret'>;
  translate: RendererTranslate;
  onChange(value: string): void;
  onError(message: string): void;
};

export function useAssistantQqSecret({ assistantId, configured, value, client, translate: t, onChange, onError }: AssistantQqSecretOptions) {
  // Revealed credentials stay outside the replacement draft and disappear with the editor.
  const [storedSecret, setStoredSecret] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [action, setAction] = useState<'reveal' | 'copy' | null>(null);
  const [copied, setCopied] = useState(false);
  const request = useRef<AbortController | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => {
    request.current?.abort();
    request.current = null;
    clearTimeout(copyTimer.current);
  }, []);

  const resetCopy = () => { clearTimeout(copyTimer.current); setCopied(false); };
  const run = async (nextAction: 'reveal' | 'copy') => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setAction(nextAction);
    resetCopy();
    try {
      const secret = value.trim() || storedSecret || (assistantId && configured
        ? (await client.revealQqSecret(assistantId, controller.signal)).secret : null);
      if (controller.signal.aborted) return;
      if (!secret) throw new Error('AppSecret is not configured.');
      if (nextAction === 'reveal') {
        setStoredSecret(secret);
        setRevealed(true);
      } else {
        await navigator.clipboard.writeText(secret);
        if (controller.signal.aborted) return;
        setCopied(true);
        copyTimer.current = setTimeout(() => setCopied(false), 1600);
      }
    } catch {
      if (!controller.signal.aborted) onError(t(nextAction === 'copy'
        ? 'feature.assistants.qqSecretCopyFailed' : 'feature.assistants.qqSecretReadFailed'));
    } finally {
      if (request.current === controller) { request.current = null; setAction(null); }
    }
  };

  return {
    inputValue: value || storedSecret || '', revealed, action, copied,
    change(next: string) {
      // Typing supersedes a pending reveal/copy; its late response must not restore or copy an old key.
      request.current?.abort();
      request.current = null;
      setAction(null);
      setStoredSecret(null);
      resetCopy();
      onChange(next);
    },
    toggle() {
      if (revealed) { setRevealed(false); setStoredSecret(null); }
      else void run('reveal');
    },
    copy() { void run('copy'); },
  };
}
