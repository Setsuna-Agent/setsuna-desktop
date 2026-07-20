import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ImagePlus, Sparkles, Upload, X } from 'lucide-react';
import type { ProviderConfigState, ProviderIconConfig } from '@setsuna-desktop/contracts';
import { Button, IconButton } from '../primitives.js';
import { ProviderBrandMark } from './ProviderBrandMark.js';
import {
  PROVIDER_BRAND_CATALOG,
  resolveAutomaticProviderBrand,
  resolveProviderBrand,
} from './providerBranding.js';
import {
  providerIconFileAccept,
  providerIconMaxSizeLabel,
  readProviderIconFile,
} from './providerIconUpload.js';

type ProviderIconDialogProps = {
  provider: ProviderConfigState;
  onClose: () => void;
  onConfirm: (icon: ProviderIconConfig | undefined) => void;
};

export function ProviderIconDialog({ provider, onClose, onConfirm }: ProviderIconDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null);
  const [draftIcon, setDraftIcon] = useState<ProviderIconConfig | undefined>(() => provider.icon);
  const [customIcon, setCustomIcon] = useState<Extract<ProviderIconConfig, { type: 'custom' }> | null>(
    provider.icon?.type === 'custom' ? provider.icon : null,
  );
  const [uploadError, setUploadError] = useState('');
  const [uploading, setUploading] = useState(false);
  const automaticBrand = resolveAutomaticProviderBrand(provider);
  const customBrand = customIcon ? resolveProviderBrand({ ...provider, icon: customIcon }) : null;

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  useEffect(() => () => previousFocusRef.current?.focus(), []);

  const chooseCustomFile = (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setUploadError('');
    void readProviderIconFile(file)
      .then((icon) => {
        setCustomIcon(icon);
        setDraftIcon(icon);
      })
      .catch((error) => setUploadError(error instanceof Error ? error.message : String(error)))
      .finally(() => setUploading(false));
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
              <strong id={titleId}>配置服务图标</strong>
              <small>{provider.name || '未命名服务'}</small>
            </div>
          </div>
          <IconButton autoFocus label="关闭图标配置" onClick={onClose}><X size={15} /></IconButton>
        </header>

        <div className="settings-provider-icon-dialog__body">
          <p id={descriptionId}>选择内置厂商品牌，或上传自己的图片。图标只保存在本机配置中。</p>

          <section className="settings-provider-icon-section" aria-labelledby={`${titleId}-presets`}>
            <div className="settings-provider-icon-section__head">
              <strong id={`${titleId}-presets`}>内置图标</strong>
              <span>{`${PROVIDER_BRAND_CATALOG.length} 个品牌`}</span>
            </div>
            <div className="settings-provider-icon-grid" role="radiogroup" aria-label="服务图标">
              <button
                className={`settings-provider-icon-option ${draftIcon === undefined ? 'is-selected' : ''}`}
                type="button"
                role="radio"
                aria-checked={draftIcon === undefined}
                onClick={() => setDraftIcon(undefined)}
              >
                <span className="settings-provider-icon-option__mark is-automatic">
                  <ProviderBrandMark brand={automaticBrand} fallbackName={provider.name} size="large" />
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
                      <ProviderBrandMark brand={brand} fallbackName={brand.label} size="large" />
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
              <span>{`PNG、JPEG、WebP · 最大 ${providerIconMaxSizeLabel}`}</span>
            </div>
            <div className={`settings-provider-icon-upload ${draftIcon?.type === 'custom' ? 'is-selected' : ''}`}>
              <input
                ref={fileInputRef}
                className="settings-provider-icon-upload__input"
                type="file"
                accept={providerIconFileAccept}
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
                  <ProviderBrandMark brand={customBrand} fallbackName={provider.name} size="large" />
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
