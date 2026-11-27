import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';
import { defineFeatureOperation } from '@setsuna-desktop/feature-core/operation';
import { parseDesignId } from './design-resource-id.js';
import { isDesignSavedRevision, type DesignPackageDestination } from './design-package.js';
import type { DesignExportFileAction, DesignExportInput, DesignPreparedExport } from './design-export.js';
import { createDesignPreviewLayerParser, type DesignPreviewLayer } from './design-preview-layers.js';
import {
  designPreviewVariantCount, maxDesignPreviewFrames, parseDesignPreviewBoardModes, parseDesignPreviewVariables,
  type DesignPreviewBoardModes, type DesignPreviewVariables,
} from './design-preview-variables.js';
import { parseDesignDocumentRef, renderDesignScript, type DesignDocumentRef } from './operations.js';
import type { DesignDocument } from './document.js';

export type DesignPreviewScript = Readonly<{ document: DesignDocument; sourceRevision: string }>;
export const renderDesignPreviewScript = defineFeatureOperation({
  id: 'design.script.preview', path: '/v1/features/design/scripts/preview', method: 'POST',
  input: renderDesignScript.input,
  output: defineRuntimeCodec<DesignPreviewScript>((value) => {
    const output = value as Partial<DesignPreviewScript> | null;
    if (!isDesignSavedRevision(output?.sourceRevision)) throw new Error('Invalid script source revision.');
    return { document: renderDesignScript.output.parse(output.document), sourceRevision: output.sourceRevision };
  }),
  errors: renderDesignScript.errors,
  idempotency: 'non-idempotent',
});

export const designPublicationChannels = {
  importPackage: 'design:import-package',
  prepareExport: 'design:prepare-export',
  useExportFile: 'design:use-export-file',
  closeExport: 'design:close-export',
  previewStatus: 'design:preview-status',
  beginPreview: 'design:begin-preview',
  appendPreviewBoard: 'design:append-preview-board',
  appendPreviewVariant: 'design:append-preview-variant',
  publishPreview: 'design:publish-preview',
  cancelPreview: 'design:cancel-preview',
  stopPreview: 'design:stop-preview',
} as const;

export const maxDesignPreviewEdge = 8_192;
export const maxDesignPreviewPixels = 16_000_000;
export const maxDesignPreviewBoardBytes = 64 * 1024 ** 2;
export const maxDesignPreviewBytes = 96 * 1024 ** 2;
export const maxDesignPreviewBoards = 1_024;
export const maxDesignPreviewPasswordLength = 128;

export type DesignPreviewAccess = Readonly<{ kind: 'link' }> | Readonly<{ kind: 'password'; password: string }>;
export type DesignPreviewFrame = Readonly<{
  width: number; height: number; flipX?: true; flipY?: true; hidden?: true; layers: DesignPreviewLayer;
}>;
export type DesignPreviewBoard = DesignPreviewFrame & Readonly<{ name: string; modes?: DesignPreviewBoardModes }>;
export type DesignPreviewIndex = Readonly<{ boards: readonly DesignPreviewBoard[]; start: number; variables?: DesignPreviewVariables }>;
export type BeginDesignPreview = DesignPreviewIndex & Readonly<{ ref: DesignDocumentRef; documentId: string; revision: string; access: DesignPreviewAccess }>;
export type DesignPublishedPreview = Readonly<{ id: string; designKey: string; documentId: string; revision: string;
  urls: readonly string[]; access: DesignPreviewAccess['kind'] }>;

export type DesignPublicationBridge = Readonly<{
  importPackage?(file: File, destination: DesignPackageDestination): Promise<DesignDocumentRef>;
  prepareExport(requestId: string, input: DesignExportInput): Promise<DesignPreparedExport | null>;
  useExportFile(requestId: string, action: DesignExportFileAction): Promise<string | null>;
  closeExport(requestId: string): Promise<void>;
  previewStatus(): Promise<DesignPublishedPreview | null>;
  beginPreview(input: BeginDesignPreview): Promise<string>;
  appendPreviewBoard(ticket: string, index: number, png: ArrayBuffer): Promise<void>;
  appendPreviewVariant(ticket: string, board: number, variant: number, frame: DesignPreviewFrame, png: ArrayBuffer): Promise<void>;
  publishPreview(ticket: string): Promise<DesignPublishedPreview>;
  cancelPreview(ticket: string): Promise<void>;
  stopPreview(id: string): Promise<void>;
}>;

export type DesignPublicationPreloadContribution = Readonly<{ designPublication?: DesignPublicationBridge }>;

export function validDesignPreviewSize(width: unknown, height: unknown): boolean {
  return typeof width === 'number' && typeof height === 'number' && Number.isSafeInteger(width) && Number.isSafeInteger(height)
    && width > 0 && height > 0 && Math.max(width, height) <= maxDesignPreviewEdge && width * height <= maxDesignPreviewPixels;
}

export function isDesignPreviewPassword(value: unknown): value is string {
  return typeof value === 'string' && value.length <= maxDesignPreviewPasswordLength && Boolean(value.trim());
}

export function parseBeginDesignPreview(value: unknown): BeginDesignPreview {
  const input = value as Partial<BeginDesignPreview> | null;
  if (!input || !isDesignSavedRevision(input.revision)
    || !Array.isArray(input.boards) || !input.boards.length || input.boards.length > maxDesignPreviewBoards
    || typeof input.start !== 'number' || !Number.isSafeInteger(input.start) || input.start < 0 || input.start >= input.boards.length) {
    throw new Error('The design preview is invalid or too large.');
  }
  const variables = parseDesignPreviewVariables(input.variables);
  const parseLayers = createDesignPreviewLayerParser();
  const boards = Array.from(input.boards as Partial<DesignPreviewBoard>[], (board): DesignPreviewBoard => {
    if (typeof board?.name !== 'string' || !board.name || board.name.length > 512) throw new Error('Invalid preview artboard name.');
    return { ...parseDesignPreviewFrame(board, parseLayers), name: board.name,
      modes: parseDesignPreviewBoardModes(board.modes, variables) };
  });
  if (boards.reduce((total, board) => total + designPreviewVariantCount(board.modes), 0) > maxDesignPreviewFrames) {
    throw new Error('Too many preview variants.');
  }
  const access = parseDesignPreviewAccess(input.access);
  return { access, ref: parseDesignDocumentRef(input.ref), documentId: parseDesignId(input.documentId),
    revision: input.revision, start: input.start, boards, variables };
}

export function parseDesignPreviewFrame(value: unknown, parseLayers = createDesignPreviewLayerParser()): DesignPreviewFrame {
  const frame = value as Partial<DesignPreviewFrame> | null;
  if (typeof frame?.width !== 'number' || typeof frame.height !== 'number' || !validDesignPreviewSize(frame.width, frame.height)) {
    throw new Error('A design preview frame is invalid or too large.');
  }
  const layers = parseLayers(frame.layers);
  if (layers.kind !== 'artboard') throw new Error('Invalid preview artboard.');
  return { width: frame.width, height: frame.height, layers, flipX: frame.flipX === true ? true : undefined,
    flipY: frame.flipY === true ? true : undefined, hidden: frame.hidden === true ? true : undefined };
}

function parseDesignPreviewAccess(value: unknown): DesignPreviewAccess {
  const access = value as Partial<DesignPreviewAccess> | null;
  if (access?.kind === 'link') return { kind: 'link' };
  if (access?.kind === 'password' && isDesignPreviewPassword(access.password)) return { kind: 'password', password: access.password };
  throw new Error('Invalid design preview access settings.');
}
