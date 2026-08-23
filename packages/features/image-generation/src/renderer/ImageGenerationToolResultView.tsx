import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';
import type { ToolResultViewProps } from '@setsuna-desktop/feature-core/renderer';

export type ImageGenerationToolResultPayload = Readonly<{
  imageCount: number;
  workspaceFiles: readonly Readonly<{ path: string; projectId?: string }>[];
  model?: string;
  size?: string;
}>;

export const imageGenerationToolResultPayloadCodec = defineRuntimeCodec<ImageGenerationToolResultPayload>((value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Image result payload must be an object.');
  const record = value as Record<string, unknown>;
  if (!Number.isSafeInteger(record.imageCount) || (record.imageCount as number) < 1) throw new Error('Image count is invalid.');
  const workspaceFiles = Array.isArray(record.workspaceFiles)
    ? record.workspaceFiles.map((file) => {
        if (!file || typeof file !== 'object' || typeof (file as { path?: unknown }).path !== 'string') throw new Error('Workspace image path is invalid.');
        const item = file as { path: string; projectId?: unknown };
        return Object.freeze({ path: item.path, ...(typeof item.projectId === 'string' ? { projectId: item.projectId } : {}) });
      })
    : [];
  return Object.freeze({
    imageCount: record.imageCount as number,
    workspaceFiles,
    ...(typeof record.model === 'string' ? { model: record.model } : {}),
    ...(typeof record.size === 'string' ? { size: record.size } : {}),
  });
});

export function ImageGenerationToolResultView({
  payload,
  translate,
}: ToolResultViewProps<ImageGenerationToolResultPayload>) {
  return (
    <div data-feature-id="image-generation" className="feature-image-generation-result">
      <strong>{translate('feature.imageGeneration.result.generated', { count: payload.imageCount })}</strong>
      {payload.model ? <span>{translate('feature.imageGeneration.result.model', { model: payload.model })}</span> : null}
      {payload.size ? <span>{translate('feature.imageGeneration.result.size', { size: payload.size })}</span> : null}
      {payload.workspaceFiles.length ? <ul>{payload.workspaceFiles.map((file) => <li key={`${file.projectId ?? ''}:${file.path}`}>{file.path}</li>)}</ul> : null}
    </div>
  );
}
