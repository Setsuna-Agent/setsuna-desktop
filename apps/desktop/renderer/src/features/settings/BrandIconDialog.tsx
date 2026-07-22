import type { BrandIconConfig } from '@setsuna-desktop/contracts';
import { Check, ImagePlus, Sparkles, Upload, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BrandIconMark } from '../../shared/branding/BrandIconMark.js';
import {
  PROVIDER_BRAND_CATALOG,
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
  const subjectLabel = subject === 'provider' ? '服务' : '模型';
  const displayName = name || `未命名${subjectLabel}`;

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
    void readBrandIconFile(file)
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
              <strong id={titleId}>{`配置${subjectLabel}图标`}</strong>
              <small>{displayName}</small>
            </div>
          </div>
          <IconButton autoFocus label="关闭图标配置" onClick={onClose}><X size={15} /></IconButton>
        </header>

        <div className="settings-provider-icon-dialog__body">
          <p id={descriptionId}>{`选择内置厂商品牌，或上传自己的图片。${subjectLabel}图标只保存在本机配置中。`}</p>

          <section className="settings-provider-icon-section" aria-labelledby={`${titleId}-presets`}>
            <div className="settings-provider-icon-section__head">
              <strong id={`${titleId}-presets`}>内置图标</strong>
              <span>{`${PROVIDER_BRAND_CATALOG.length} 个品牌`}</span>
            </div>
            <div className="settings-provider-icon-grid" role="radiogroup" aria-label={`${subjectLabel}图标`}>
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
                <span>自动匹配</span>
                {draftIcon === undefined ? <Check className="settings-provider-icon-option__check" size={12} /> : null}
              </button>
              {PROVIDER_BRAND_CATALOG.map((brand) => {
                const selected = draftIcon?.type === 'preset' && draftIcon.key === brand.key;
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
                      <BrandIconMark brand={brand} fallbackName={brand.label} size="large" />
                    </span>
                    <span title={brand.label}>{brand.label}</span>
                    {selected ? <Check className="settings-provider-icon-option__check" size={12} /> : null}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="settings-provider-icon-section" aria-labelledby={`${titleId}-custom`}>
            <div className="settings-provider-icon-section__head">
              <strong id={`${titleId}-custom`}>自定义上传</strong>
              <span>{`PNG、JPEG、WebP · 最大 ${brandIconMaxSizeLabel}`}</span>
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
                <strong>{customIcon ? '自定义图片' : '上传你的品牌图标'}</strong>
                <span>{customIcon ? '点击预览可重新选中该图片' : '建议使用透明背景的正方形图片'}</span>
              </div>
              <Button
                disabled={uploading}
                icon={<Upload size={13} />}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? '读取中' : customIcon ? '更换图片' : '选择图片'}
              </Button>
            </div>
            {uploadError ? <p className="settings-provider-icon-upload__error" role="alert">{uploadError}</p> : null}
          </section>
        </div>

        <footer className="settings-provider-icon-dialog__footer">
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" disabled={uploading} onClick={() => onConfirm(draftIcon)}>应用图标</Button>
        </footer>
      </section>
    </div>
  );

  return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body);
}
