import { useCallback, useEffect, useRef, useState } from 'react';
import { usePageSessionState } from '@setsuna-desktop/renderer-ui';
import { useToast } from '../../../app/providers/ToastProvider.js';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import type { RuntimePreferenceInput } from '../settings-types.js';

/** A save acknowledgement must never replace text entered after that save started. */
export function usePersonalizationPrompt(value: string, save: (input: RuntimePreferenceInput) => Promise<void>) {
  const [session, remember] = usePageSessionState('settings:personalization:prompt', () => ({
    draft: value, dirty: false, revision: 0, submitted: null as number | null, failureToast: null as number | null,
  }));
  const [draft, setDraft] = useState(session.dirty ? session.draft : value);
  const current = useRef(session);
  const saveRef = useRef(save);
  saveRef.current = save;
  const toast = useToast();
  const { t } = useI18n();

  useEffect(() => {
    if (!current.current.dirty) {
      current.current.draft = value;
      setDraft(value);
    }
  }, [value]);

  const flush = useCallback(() => {
    const state = current.current;
    if (!state.dirty || state.submitted === state.revision) return;
    const submitted = state.draft;
    const revision = state.revision;
    state.submitted = revision;
    void saveRef.current({ globalPrompt: submitted }).then(() => {
      if (state.revision !== revision) return;
      state.dirty = false;
      if (state.failureToast !== null) toast.dismiss(state.failureToast);
      state.failureToast = null;
    }).catch((error: unknown) => {
      if (state.submitted !== revision) return;
      state.submitted = null;
      if (state.failureToast !== null) toast.dismiss(state.failureToast);
      state.failureToast = toast.error(error instanceof Error ? error.message : String(error), {
        durationMs: null,
        action: { label: t('common.retry'), onClick: flush },
      });
    });
  }, [t, toast]);
  const flushRef = useRef(flush);
  flushRef.current = flush;

  useEffect(() => {
    const timer = window.setTimeout(flush, 360);
    return () => window.clearTimeout(timer);
  }, [draft, flush]);
  useEffect(() => () => flushRef.current(), []);

  return {
    draft,
    flush,
    change(next: string) {
      current.current.draft = next;
      current.current.dirty = true;
      current.current.revision += 1;
      remember(current.current);
      setDraft(next);
    },
  };
}
