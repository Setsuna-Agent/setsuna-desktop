import { useCallback, useEffect, useRef, useState } from 'react';
import type { RuntimeInlineMessageAttachment } from '@setsuna-desktop/contracts';
import {
  BROWSER_ANNOTATION_LIMIT,
  browserAnnotationMessage,
  type BrowserAnnotation,
  type BrowserAnnotationTarget,
  type BrowserAnnotationSendHandler,
  type BrowserDesktopBridge,
} from '../../contracts/index.js';
import type { BrowserNotify } from '../types.js';
import type { BrowserTranslate } from '../messages.js';

export function useBrowserAnnotations({ bridge, tabId, url, available, hidden, notify, translate, onSend }: {
  bridge: BrowserDesktopBridge | null;
  tabId: string;
  url: string;
  available: boolean;
  hidden: boolean;
  notify: BrowserNotify;
  translate: BrowserTranslate;
  onSend?: BrowserAnnotationSendHandler;
}) {
  const [open, setOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [markersVisible, setMarkersVisible] = useState(true);
  const [picking, setPicking] = useState(false);
  const [sending, setSending] = useState(false);
  const [annotations, setAnnotations] = useState<BrowserAnnotation[]>([]);
  const [sentComments, setSentComments] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [target, setTarget] = useState<BrowserAnnotationTarget | null>(null);
  const [comment, setComment] = useState('');
  const request = useRef(0);
  const batchRevision = useRef(0);
  const sendingRef = useRef(false);
  const pickingRef = useRef(false);
  const mounted = useRef(true);

  const cancel = useCallback(() => {
    ++request.current;
    pickingRef.current = false;
    setPicking(false);
    void bridge?.cancelAnnotation(tabId).catch(() => undefined);
  }, [bridge, tabId]);

  const clear = useCallback(() => {
    cancel();
    ++batchRevision.current;
    setAnnotations([]);
    setSentComments(new Map());
    setTarget(null);
    setComment('');
    setListOpen(false);
  }, [cancel]);

  useEffect(() => {
    cancel();
  }, [cancel, hidden, available, url]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      ++request.current;
      void bridge?.cancelAnnotation(tabId).catch(() => undefined);
      void bridge?.setAnnotationMarkers(tabId, { ids: [], visible: false }).catch(() => undefined);
    };
  }, [bridge, tabId]);
  useEffect(() => {
    if (sending) return;
    const ids = annotations.map((item) => item.target.id);
    if (target && !ids.includes(target.id)) ids.push(target.id);
    void bridge?.setAnnotationMarkers(tabId, {
      ids,
      activeId: target?.id ?? null,
      visible: markersVisible && !hidden,
    }).catch(() => undefined);
  }, [annotations, bridge, hidden, markersVisible, sending, tabId, target, url]);

  const pendingAnnotations = (): BrowserAnnotation[] => {
    if (!target || !comment.trim()) return annotations;
    const item = { target, comment: comment.trim() };
    return annotations.some((saved) => saved.target.id === target.id)
      ? annotations.map((saved) => saved.target.id === target.id ? item : saved)
      : [...annotations, item];
  };
  const commitDraft = () => {
    const saved = pendingAnnotations();
    setAnnotations(saved);
    setTarget(null);
    setComment('');
    return saved;
  };
  const beginPick = async (saved: BrowserAnnotation[]) => {
    if (!available || hidden || !bridge || sendingRef.current || pickingRef.current) return;
    if (saved.length >= BROWSER_ANNOTATION_LIMIT) return;
    setOpen(true);
    setListOpen(false);
    setMarkersVisible(true);
    pickingRef.current = true;
    setPicking(true);
    const revision = ++request.current;
    try {
      const selection = await bridge.pickAnnotation(tabId);
      if (revision !== request.current || !mounted.current) return;
      setTarget(selection);
      setComment(saved.find((item) => item.target.id === selection?.id)?.comment ?? '');
    } catch {
      if (revision === request.current && mounted.current) notify('error', translate('feature.browser.annotation.failed'));
    } finally {
      if (revision === request.current && mounted.current) {
        pickingRef.current = false;
        setPicking(false);
      }
    }
  };
  const pick = () => beginPick(commitDraft());
  const save = () => {
    const editing = annotations.some((item) => item.target.id === target?.id);
    const saved = commitDraft();
    // Saving a new note continues the selection session; editing keeps the existing order.
    if (!editing) void beginPick(saved);
  };
  const hasChanges = (items: readonly BrowserAnnotation[]) => items.some((item) => sentComments.get(item.target.id) !== item.comment);
  const send = async () => {
    const items = pendingAnnotations();
    if (!available || !hasChanges(items) || !onSend || !bridge || sendingRef.current) return;
    cancel();
    const revision = request.current;
    const batch = batchRevision.current;
    sendingRef.current = true;
    setSending(true);
    setMarkersVisible(true);
    try {
      const screenshots = await bridge.captureAnnotationScreenshots(tabId, items.map((item) => item.target.id));
      if (!mounted.current || revision !== request.current) return;
      if (!screenshots || screenshots.length !== items.length) throw new Error('Could not capture every annotation.');
      const timestamp = Date.now();
      const attachments: RuntimeInlineMessageAttachment[] = screenshots.map((screenshot, index) => ({
        id: `browser_annotation_${timestamp.toString(36)}_${index + 1}`,
        name: `browser-annotation-${index + 1}-${timestamp}.png`,
        type: screenshot.mimeType,
        size: screenshot.size,
        url: screenshot.dataUrl,
      }));
      const accepted = await onSend(browserAnnotationMessage(tabId, items), attachments);
      // Hiding the panel can cancel picking; only clearing/navigating ends this saved batch.
      if (!mounted.current || batch !== batchRevision.current) return;
      if (accepted) {
        // Sending acknowledges this batch without removing its page markers or edit history.
        setAnnotations(items);
        setSentComments(new Map(items.map((item) => [item.target.id, item.comment])));
        setTarget(null);
        setComment('');
        setListOpen(false);
      } else notify('error', translate('feature.browser.annotation.sendFailed'));
    } catch {
      if (mounted.current && revision === request.current) notify('error', translate('feature.browser.annotation.sendFailed'));
    } finally {
      sendingRef.current = false;
      if (mounted.current) setSending(false);
    }
  };

  return {
    annotations, comment, listOpen, markersVisible, open, picking, sending, target,
    canClear: Boolean(annotations.length || target),
    canPick: available && pendingAnnotations().length < BROWSER_ANNOTATION_LIMIT && !sending,
    canSend: Boolean(available && onSend && hasChanges(pendingAnnotations()) && !sending),
    close: () => { cancel(); setOpen(false); },
    cancelPick: cancel,
    clear,
    toggleMarkers: () => setMarkersVisible((value) => !value),
    toggleList: () => { cancel(); commitDraft(); setListOpen((value) => !value); },
    toggle: () => {
      if (open) { cancel(); setOpen(false); }
      else if (annotations.length || target) setOpen(true);
      else void pick();
    },
    edit: (item: BrowserAnnotation) => {
      if (target?.id === item.target.id) return;
      cancel(); commitDraft(); setListOpen(false); setMarkersVisible(true); setTarget(item.target); setComment(item.comment);
    },
    remove: (id: string) => {
      setAnnotations((items) => items.filter((item) => item.target.id !== id));
      if (target?.id === id) { setTarget(null); setComment(''); }
    },
    discard: () => { setTarget(null); setComment(''); },
    pick, save, send, setComment,
  };
}
