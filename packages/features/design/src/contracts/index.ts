import type { WorkspaceEntry } from '@setsuna-desktop/contracts';
import { defineCapability } from '@setsuna-desktop/feature-core/capability';
import { defineFeature } from '@setsuna-desktop/feature-core/definition';
import type { CreateDesignDocumentInput, DesignDocumentRef, DesignImageExtension, DesignWorkspace } from './operations.js';

export {
  designBlendModes, designDocumentCodec, designDocumentVersion, designFillImageFits, designFontFamilies, designFontWeights, designFrameFill, designImageFits, designTextAlignments, designTextFill,
  indexDesignParents, maxDesignFills, maxDesignStrokes, parseAssetPath, validateDesignComponents,
  type DesignBlendMode, type DesignContentOverride, type DesignDocument, type DesignEdit, type DesignEllipse, type DesignFill, type DesignFillImage,
  type DesignFrame, type DesignGradient, type DesignGradientStop, type DesignImage, type DesignInteraction, type DesignLayout, type DesignLibraryLinks, type DesignNode,
  type DesignQuad, type DesignRectangle, type DesignShadow, type DesignSizeMode, type DesignStroke, type DesignStyle, type DesignText,
  type DesignTextRun, type DesignTypography, type DesignVector,
} from './document.js';
export { designTypographyOf, resolveDesignNodeStyles, resolveDesignStyles } from './design-styles.js';
export { rebaseDesignTextRuns, updateDesignTextRange } from './design-text-runs.js';
export { designDocumentFileExtension, designDocumentFileName, isDesignDocumentPath } from './design-resource-id.js';
export {
  defaultDesignPolygonSides, designIconNames, designSvgNumberPattern, maxDesignPathAnchors, maxDesignPolygonSides, maxDesignSvgPaths,
  minDesignPolygonSides, parseDesignSvgNumber, parseDesignSvgPathData,
  type DesignIconName, type DesignPathAnchor, type DesignPathGeometry, type DesignSvgGeometry, type DesignSvgMatrix,
  type DesignSvgPath, type DesignSvgViewBox, type DesignVectorGeometry,
} from './vector-geometry.js';
export {
  commitDesignEdits, createDesignDocument, designImageExtensions, designImageFileExtensions, importDesignImage,
  listDesignDocuments, navigateDesignHistory, readDesignDocument, type CommitDesignEditsInput, type CreateDesignDocumentInput, type DesignDocumentRef,
  type DesignSnapshot, type DesignWorkspace, type ImportDesignImageInput, type NavigateDesignHistoryInput,
} from './operations.js';

export const designFeature = defineFeature('design');

export type DesignWorkspaceDocument = Readonly<{
  key: string;
  read(): Promise<Readonly<{ content: string; revision: string }>>;
  replace(content: string, expectedRevision: string): Promise<string>;
}>;

export interface DesignWorkspaceFiles {
  list(workspace: DesignWorkspace, signal: AbortSignal): Promise<readonly string[]>;
  create(input: CreateDesignDocumentInput, content: string, signal: AbortSignal): Promise<WorkspaceEntry>;
  importImage(ref: DesignDocumentRef, image: Readonly<{ name: string; extension: DesignImageExtension; bytes: Uint8Array }>,
    signal: AbortSignal): Promise<string>;
  withDocument<T>(
    ref: DesignDocumentRef, signal: AbortSignal, operation: (file: DesignWorkspaceDocument) => Promise<T>,
  ): Promise<T>;
}

export const designWorkspaceFilesCapability = defineCapability<DesignWorkspaceFiles>({
  id: 'design.workspace-files',
  description: 'Create design files, import image assets, and serialize workspace document writes.',
});
