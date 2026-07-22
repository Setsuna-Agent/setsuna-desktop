import type { BrandIconConfig } from '@setsuna-desktop/contracts';
import { Check, ImagePlus, Sparkles, Upload, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BrandIconMark } from '../../shared/branding/BrandIconMark.js';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import {
  PROVIDER_BRAND_CATALOG,
  localizedProviderBrandLabel,
  resolveBrandIcon,
  type ProviderBrandAsset,
} from '../../shared/branding/providerBranding.js';
import { Button, IconButton } from '../../shared/ui/primitives.js';
import {
  brandIconFileAccept,
  brandIconMaxSizeLabel,
  readBrandIconFile,
} from './brandIconUpload.js';

type BrandIconDialogProps = {
  automaticBrand: ProviderBrandAsset | null;
  icon?: BrandIconConfig;
  name: string;
  subject: 'model' | 'provider';
  onClose: () => void;
  onConfirm: (icon: BrandIconConfig | undefined) => void;
};

export function BrandIconDialog({ automaticBrand, icon, name, subject, onClose, onConfirm }: BrandIconDialogProps) {
  const { t } = useI18n();
  const titleId = useId();
  const descriptionId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isMountedRef = useRef(true);
  const previousFocusRef = useRef<HTMLElement | null>(typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null);
  const [draftIcon, setDraftIcon] = useState<BrandIconConfig | undefined>(() => icon);
  const [customIcon, setCustomIcon] = useState<Extract<BrandIconConfig, { type: 'custom' }> | null>(
    icon?.type === 'custom' ? icon : null,
  );
  const [uploadError, setUploadError] = useState('');
  const [uploading, setUploading] = useState(false);
  const customBrand = customIcon ? resolveBrandIcon(customIcon, null) : null;
  const subjectLabel = t(subject === 'provider' ? 'settings.brand.provider' : 'settings.brand.model');
  const displayName = name || t('settings.brand.unnamed', { subject: subjectLabel });
  const uploadCopy = {
    emptyFile: t('settings.brand.emptyFile'),
    invalidContent: t('settings.brand.invalidContent'),
    invalidType: t('settings.brand.invalidType'),
    readError: t('settings.brand.readError'),
    tooLarge: t('settings.brand.tooLarge', { size: brandIconMaxSizeLabel }),
  };

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      previousFocusRef.current?.focus();
    };
  }, []);

  const chooseCustomFile = (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setUploadError('');
    void readBrandIconFile(file, uploadCopy)
      .then((icon) => {
        if (!isMountedRef.current) return;
        setCustomIcon(icon);
        setDraftIcon(icon);
      })
      .catch((error) => {
        if (isMountedRef.current) setUploadError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (isMountedRef.current) setUploading(false);
      });
  };

  const dialog = (
    <div className="desktop-agent-modal-backdrop settings-provider-icon-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="desktop-agent-modal settings-provider-icon-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="settings-provider-icon-dialog__header">
          <div className="settings-provider-icon-dialog__title">
            <span><ImagePlus size={16} /></span>
            <div>
              <strong id={titleId}>{t('settings.brand.title', { subject: subjectLabel })}</strong>
              <small>{displayName}</small>
            </div>
          </div>
          <IconButton autoFocus label={t('settings.brand.close')} onClick={onClose}><X size={15} /></IconButton>
        </header>

        <div className="settings-provider-icon-dialog__body">
          <p id={descriptionId}>{t('settings.brand.description', { subject: subjectLabel })}</p>

          <section className="settings-provider-icon-section" aria-labelledby={`${titleId}-presets`}>
            <div className="settings-provider-icon-section__head">
              <strong id={`${titleId}-presets`}>{t('settings.brand.presets')}</strong>
              <span>{t('settings.brand.brandCount', { count: PROVIDER_BRAND_CATALOG.length })}</span>
            </div>
            <div className="settings-provider-icon-grid" role="radiogroup" aria-label={t('settings.brand.iconLabel', { subject: subjectLabel })}>
              <button
                className={`settings-provider-icon-option ${draftIcon === undefined ? 'is-selected' : ''}`}
                type="button"
                role="radio"
                aria-checked={draftIcon === undefined}
                onClick={() => setDraftIcon(undefined)}
              >
                <span className="settings-provider-icon-option__mark is-automatic">
                  <BrandIconMark brand={automaticBrand} fallbackName={displayName} size="large" />
                  <Sparkles size={10} />
                </span>
                <span>{t('settings.brand.automatic')}</span>
                {draftIcon === undefined ? <Check className="settings-provider-icon-option__check" size={12} /> : null}
              </button>
              {PROVIDER_BRAND_CATALOG.map((brand) => {
                const selected = draftIcon?.type === 'preset' && draftIcon.key === brand.key;
                const brandLabel = localizedProviderBrandLabel(brand, t);
                return (
                  <button
                    className={`settings-provider-icon-option ${selected ? 'is-selected' : ''}`}
                    key={brand.key}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setDraftIcon({ type: 'preset', key: brand.key })}
                  >
                    <span className="settings-provider-icon-option__mark">
                      <BrandIconMark brand={brand} fallbackName={brandLabel} size="large" />
                    </span>
                    <span title={brandLabel}>{brandLabel}</span>
                    {selected ? <Check className="settings-provider-icon-option__check" size={12} /> : null}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="settings-provider-icon-section" aria-labelledby={`${titleId}-custom`}>
            <div className="settings-provider-icon-section__head">
              <strong id={`${titleId}-custom`}>{t('settings.brand.customUpload')}</strong>
              <span>{t('settings.brand.uploadLimits', { size: brandIconMaxSizeLabel })}</span>
            </div>
            <div className={`settings-provider-icon-upload ${draftIcon?.type === 'custom' ? 'is-selected' : ''}`}>
              <input
                ref={fileInputRef}
                className="settings-provider-icon-upload__input"
                type="file"
                accept={brandIconFileAccept}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = '';
                  chooseCustomFile(file);
                }}
              />
              <button
                className="settings-provider-icon-upload__preview"
                type="button"
                disabled={!customIcon}
                aria-pressed={draftIcon?.type === 'custom'}
                onClick={() => {
                  if (customIcon) setDraftIcon(customIcon);
                }}
              >
                {customBrand ? (
                  <BrandIconMark brand={customBrand} fallbackName={displayName} size="large" />
                ) : (
                  <span className="settings-provider-icon-upload__placeholder"><ImagePlus size={18} /></span>
                )}
              </button>
              <div className="settings-provider-icon-upload__copy">
                <strong>{customIcon ? t('settings.brand.customImage') : t('settings.brand.uploadTitle')}</strong>
                <span>{customIcon ? t('settings.brand.reselect') : t('settings.brand.uploadHint')}</span>
              </div>
              <Button
                disabled={uploading}
                icon={<Upload size={13} />}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? t('settings.brand.reading') : customIcon ? t('settings.brand.replaceImage') : t('settings.brand.chooseImage')}
              </Button>
            </div>
            {uploadError ? <p className="settings-provider-icon-upload__error" role="alert">{uploadError}</p> : null}
          </section>
        </div>

        <footer className="settings-provider-icon-dialog__footer">
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={uploading} onClick={() => onConfirm(draftIcon)}>{t('settings.brand.apply')}</Button>
        </footer>
      </section>
    </div>
  );

  return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body);
}
