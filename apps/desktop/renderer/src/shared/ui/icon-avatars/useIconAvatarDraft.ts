import type { BrandIconConfig } from '@setsuna-desktop/contracts';
import { useEffect, useRef, useState } from 'react';
import { brandIconMaxSizeLabel, readBrandIconFile } from '../../branding/brandIconUpload.js';
import { websiteIconToAvatar } from '../../branding/websiteIcon.js';
import { useI18n } from '../../i18n/I18nProvider.js';

type CustomAvatar = Extract<BrandIconConfig, { type: 'custom' }>;
type AvatarSource = 'upload' | 'website';

export function useIconAvatarDraft(initialAvatar?: BrandIconConfig) {
  const { t } = useI18n();
  const mounted = useRef(true);
  const pending = useRef(false);
  const [avatar, setAvatar] = useState(initialAvatar);
  const [customAvatar, setCustomAvatar] = useState<CustomAvatar | undefined>(initialAvatar?.type === 'custom' ? initialAvatar : undefined);
  const [loading, setLoading] = useState<AvatarSource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorRevision, setErrorRevision] = useState(0);
  const reportError = (message: string) => {
    setError(message);
    setErrorRevision((revision) => revision + 1);
  };
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const readAvatar = async (source: AvatarSource, read: () => Promise<CustomAvatar>) => {
    if (pending.current) return;
    pending.current = true;
    setLoading(source);
    setError(null);
    try {
      const image = await read();
      if (!mounted.current) return;
      setCustomAvatar(image);
      setAvatar(image);
    } catch (cause) {
      if (!mounted.current) return;
      reportError(source === 'website' ? t('pluginUi.fetchAvatarFailed')
        : cause instanceof Error ? cause.message : t('settings.brand.readError'));
    } finally {
      pending.current = false;
      if (mounted.current) setLoading(null);
    }
  };

  const upload = (file: File) => readAvatar('upload', () => readBrandIconFile(file, {
    emptyFile: t('settings.brand.emptyFile'),
    invalidContent: t('settings.brand.invalidContent'),
    invalidType: t('settings.brand.invalidType'),
    readError: t('settings.brand.readError'),
    tooLarge: t('settings.brand.tooLarge', { size: brandIconMaxSizeLabel }),
  }));
  const fetchWebsiteIcon = (url: string) => readAvatar('website', async () => {
    const dataUrl = await window.setsunaDesktop?.browser.getWebsiteFavicon(url);
    if (!mounted.current) throw new Error('Avatar editor was closed.');
    return websiteIconToAvatar(dataUrl ?? null);
  });

  return { avatar, setAvatar, customAvatar, loading, error, errorRevision, reportError, upload, fetchWebsiteIcon };
}
