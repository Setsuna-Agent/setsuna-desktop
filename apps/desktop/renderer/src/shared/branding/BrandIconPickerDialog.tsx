import type { BrandIconConfig } from '@setsuna-desktop/contracts';
import { Check, ImagePlus, Sparkles, Upload } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider.js';
import { Button } from '../ui/primitives.js';
import { SettingsDialog } from '../ui/SettingsDialog.js';
import { BrandIconMark } from './BrandIconMark.js';
import {
  brandIconFileAccept,
  brandIconMaxSizeLabel,
  readBrandIconFile,
} from './brandIconUpload.js';
import {
  PROVIDER_BRAND_CATALOG,
  localizedProviderBrandLabel,
  resolveBrandIcon,
  type ProviderBrandAsset,
} from './providerBranding.js';

export type BrandIconPickerDialogProps = Readonly<{
  automaticBrand: ProviderBrandAsset | null;
  icon?: BrandIconConfig;
  name: string;
  subject: 'model' | 'provider';
  onClose(): void;
  onConfirm(icon: BrandIconConfig | undefined): void;
}>;

export function BrandIconPickerDialog({
  automaticBrand,
  icon,
  name,
  subject,
  onClose,
  onConfirm,
}: BrandIconPickerDialogProps) {
  const { t } = useI18n();
  const titleId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isMountedRef = useRef(true);
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
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const chooseCustomFile = (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setUploadError('');
    void readBrandIconFile(file, uploadCopy)
      .then((nextIcon) => {
        if (!isMountedRef.current) return;
        setCustomIcon(nextIcon);
        setDraftIcon(nextIcon);
      })
      .catch((error: unknown) => {
        if (isMountedRef.current) setUploadError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (isMountedRef.current) setUploading(false);
      });
  };

  return (
    <SettingsDialog
      className="settings-provider-icon-dialog"
      closeLabel={t('settings.brand.close')}
      footer={(
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button disabled={uploading} variant="primary" onClick={() => onConfirm(draftIcon)}>
            {t('settings.brand.apply')}
          </Button>
        </>
      )}
      size="large"
      subtitle={displayName}
      title={t('settings.brand.title', { subject: subjectLabel })}
      titleIcon={<ImagePlus size={16} />}
      onClose={onClose}
    >
      <div className="settings-provider-icon-dialog__content">
          <p>{t('settings.brand.description', { subject: subjectLabel })}</p>
          <section className="settings-provider-icon-section" aria-labelledby={`${titleId}-presets`}>
            <div className="settings-provider-icon-section__head">
              <strong id={`${titleId}-presets`}>{t('settings.brand.presets')}</strong>
              <span>{t('settings.brand.brandCount', { count: PROVIDER_BRAND_CATALOG.length })}</span>
            </div>
            <div className="settings-provider-icon-grid" role="radiogroup" aria-label={t('settings.brand.iconLabel', { subject: subjectLabel })}>
              <button
                aria-checked={draftIcon === undefined}
                className={`settings-provider-icon-option ${draftIcon === undefined ? 'is-selected' : ''}`}
                role="radio"
                type="button"
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
                const label = localizedProviderBrandLabel(brand, t);
                return (
                  <button
                    key={brand.key}
                    aria-checked={selected}
                    className={`settings-provider-icon-option ${selected ? 'is-selected' : ''}`}
                    role="radio"
                    type="button"
                    onClick={() => setDraftIcon({ type: 'preset', key: brand.key })}
                  >
                    <span className="settings-provider-icon-option__mark">
                      <BrandIconMark brand={brand} fallbackName={label} size="large" />
                    </span>
                    <span title={label}>{label}</span>
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
                accept={brandIconFileAccept}
                className="settings-provider-icon-upload__input"
                type="file"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = '';
                  chooseCustomFile(file);
                }}
              />
              <button
                aria-pressed={draftIcon?.type === 'custom'}
                className="settings-provider-icon-upload__preview"
                disabled={!customIcon}
                type="button"
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
                {uploading
                  ? t('settings.brand.reading')
                  : customIcon ? t('settings.brand.replaceImage') : t('settings.brand.chooseImage')}
              </Button>
            </div>
            {uploadError ? <p className="settings-provider-icon-upload__error" role="alert">{uploadError}</p> : null}
          </section>
      </div>
    </SettingsDialog>
  );
}
