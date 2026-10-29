import { BRAND_ICON_MAX_BYTES, BRAND_ICON_MIME_TYPES } from '@setsuna-desktop/contracts';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { readImageFile } from '@setsuna-desktop/renderer-ui';
import { useEffect, useRef, useState } from 'react';
import { collaborationAgentAvatarCodec, type CollaborationAgentAvatar } from '../contracts/index.js';

export function useAgentAvatarUpload(t: RendererTranslate, onChange: (avatar: CollaborationAgentAvatar) => void, onBusyChange: (busy: boolean) => void) {
  const mounted = useRef(true);
  const pending = useRef(false);
  const errorId = useRef(0);
  const [error, setError] = useState<{ message: string; id: number } | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const upload = async (file: File) => {
    if (pending.current) return;
    pending.current = true;
    onBusyChange(true);
    setError(null);
    try {
      const dataUrl = await readImageFile(file, {
        mimeTypes: BRAND_ICON_MIME_TYPES, maxBytes: BRAND_ICON_MAX_BYTES,
        copy: {
          emptyFile: t('feature.collaboration.avatar.emptyFile'),
          invalidType: t('feature.collaboration.avatar.invalidType'),
          readError: t('feature.collaboration.avatar.readError'),
          tooLarge: t('feature.collaboration.avatar.tooLarge', { size: Math.round(BRAND_ICON_MAX_BYTES / 1024) }),
        },
      });
      const avatar = collaborationAgentAvatarCodec.parse({ type: 'custom', dataUrl });
      if (mounted.current) onChange(avatar);
    } catch (error) {
      if (mounted.current) setError({
        message: error instanceof Error ? error.message : t('feature.collaboration.avatar.readError'), id: ++errorId.current,
      });
    } finally {
      pending.current = false;
      if (mounted.current) onBusyChange(false);
    }
  };
  return { upload, error };
}
