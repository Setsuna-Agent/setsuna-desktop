import type { ProviderModelConfig } from '@setsuna-desktop/contracts';
import { AlertTriangle, X } from 'lucide-react';
import { useEffect, useId } from 'react';
import { createPortal } from 'react-dom';
import { Button, IconButton } from '../../shared/ui/primitives.js';

type ProviderModelReplacementDialogProps = {
  providerName: string;
  currentModels: ProviderModelConfig[];
  nextModels: ProviderModelConfig[];
  onCancel: () => void;
  onConfirm: () => void;
};

export function ProviderModelReplacementDialog({
  providerName,
  currentModels,
  nextModels,
  onCancel,
  onConfirm,
}: ProviderModelReplacementDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const currentCodes = new Set(currentModels.map(modelComparisonKey));
  const nextCodes = new Set(nextModels.map(modelComparisonKey));
  const addedCount = nextModels.filter((model) => !currentCodes.has(modelComparisonKey(model))).length;
  const removedCount = currentModels.filter((model) => !nextCodes.has(modelComparisonKey(model))).length;
  const retainedCount = nextModels.length - addedCount;
  const columns = [
    { key: 'current', title: '当前配置', models: currentModels, comparisonCodes: nextCodes },
    { key: 'next', title: '替换后', models: nextModels, comparisonCodes: currentCodes },
  ] as const;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  const dialog = (
    <div className="desktop-agent-modal-backdrop settings-model-replacement-backdrop" role="presentation" onMouseDown={onCancel}>
      <section
        className="desktop-agent-modal settings-model-replacement-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="settings-model-replacement-dialog__header">
          <div className="settings-model-replacement-dialog__title">
            <AlertTriangle size={17} aria-hidden="true" />
            <div>
              <strong id={titleId}>{`替换“${providerName || '未命名厂商'}”的模型列表？`}</strong>
              <span>{`${currentModels.length} 个模型 → ${nextModels.length} 个模型`}</span>
            </div>
          </div>
          <IconButton label="取消替换" onClick={onCancel}>
            <X size={15} />
          </IconButton>
        </header>
        <div className="settings-model-replacement-dialog__body">
          <p id={descriptionId}>
            确认后会使用获取结果完整替换当前列表。右侧没有的模型及其本地配置将被删除，取消则不会修改现有配置。
          </p>
          <div className="settings-model-replacement-summary" aria-label="模型变更摘要">
            <span>{`新增 ${addedCount}`}</span>
            <span>{`移除 ${removedCount}`}</span>
            <span>{`保留 ${retainedCount}`}</span>
          </div>
          <div className="settings-model-replacement-columns">
            {columns.map((column) => (
              <section className="settings-model-replacement-column" key={column.key} aria-label={column.title}>
                <div className="settings-model-replacement-column__head">
                  <strong>{column.title}</strong>
                  <span>{`${column.models.length} 个`}</span>
                </div>
                <div className="settings-model-replacement-list" role="list">
                  {column.models.map((model) => {
                    const retained = column.comparisonCodes.has(modelComparisonKey(model));
                    const changeLabel = retained ? '保留' : column.key === 'current' ? '将移除' : '新增';
                    return (
                      <div className="settings-model-replacement-item" key={`${model.id}:${model.code}`} role="listitem">
                        <div className="settings-model-replacement-item__body">
                          <strong>{model.name || model.code || '未命名模型'}</strong>
                          <code>{model.code || '未填写模型 ID'}</code>
                          <span>{modelDetails(model)}</span>
                        </div>
                        <div className="settings-model-replacement-item__meta">
                          {model.enabled ? <span>默认</span> : null}
                          <span className={`is-${retained ? 'retained' : column.key === 'current' ? 'removed' : 'added'}`}>{changeLabel}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </div>
        <footer className="settings-model-replacement-dialog__footer">
          <Button autoFocus type="button" onClick={onCancel}>
            保留当前配置
          </Button>
          <Button type="button" variant="danger" onClick={onConfirm}>
            确认替换
          </Button>
        </footer>
      </section>
    </div>
  );

  return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body);
}

function modelComparisonKey(model: ProviderModelConfig): string {
  return model.code.trim() || model.id;
}

function modelDetails(model: ProviderModelConfig): string {
  return [
    `输出 ${model.maxOutputTokens}`,
    model.contextWindowTokens ? `上下文 ${model.contextWindowTokens}` : '',
    model.thinkingEnabled ? '思考' : '',
    model.supportsImages ? '图片' : '',
  ].filter(Boolean).join(' · ');
}
