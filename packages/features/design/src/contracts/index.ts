import type { WorkspaceEntry } from '@setsuna-desktop/contracts';
import { defineCapability } from '@setsuna-desktop/feature-core/capability';
import { defineFeature } from '@setsuna-desktop/feature-core/definition';
import type { ChatDesignScope, ProjectDesignEntry } from './chat-design.js';
import type { DesignStorage } from './design-storage.js';
import type { DesignDocument } from './document.js';
import type { CreateDesignDocumentInput, DesignDocumentRef, DesignImageExtension, DesignWorkspace, MoveDesignDocumentInput } from './operations.js';
import type { DesignScriptCanvas } from './design-script-parameters.js';

export {
  designBlendModes, designDocumentCodec, designDocumentVersion, designFillImageFits, designFontFamilies, designGradientKinds, designImageFits, designTextAlignments,
  indexDesignParents, maxDesignFills, maxDesignGradientStops, maxDesignStrokes, parseAssetPath, validateDesignComponents,
  type DesignBlendMode, type DesignContentOverride, type DesignDocument, type DesignEdit, type DesignEllipse, type DesignFill, type DesignFillImage,
  type DesignFrame, type DesignGradient, type DesignGradientAxis, type DesignGradientStop, type DesignImage, type DesignInteraction, type DesignLayout, type DesignLibraryLinks, type DesignNode,
  type DesignPaint, type DesignQuad, type DesignRectangle, type DesignScript, type DesignShadow, type DesignSizeMode, type DesignStroke, type DesignStyle, type DesignText,
  type DesignTextRun, type DesignTypography, type DesignVector, type DesignWeb,
} from './document.js';
export { maxDesignScriptBytes, parseDesignScriptPath, parseDesignWebUrl } from './design-content-source.js';
export type { DesignScriptCanvas, DesignScriptInputs, DesignScriptParameter, DesignScriptValue } from './design-script-parameters.js';
export { designFontWeights } from './design-fonts.js';
export { designTypographyOf, resolveDesignNodeStyles } from './design-styles.js';
export { designDocumentImagePaths, designLayerImagePaths, designLayerShaderPaths, designPaintImagePaths } from './design-image-references.js';
export { maxDesignShaderBytes, parseDesignShaderPath, parseDesignShaderSource,
  type DesignShaderPaint, type DesignShaderSampler, type DesignShaderValue } from './design-shader.js';
export { rebaseDesignTextRuns, updateDesignTextRange } from './design-text-runs.js';
export { designDocumentFileExtension, designDocumentFileName, isDesignDocumentPath } from './design-resource-id.js';
export {
  defaultDesignPolygonSides, designBrushPresets, designIconNames, designPencilPresets, designSvgNumberPattern, maxDesignPathAnchors, maxDesignPolygonSides, maxDesignSvgPaths,
  minDesignPolygonSides, parseDesignSvgNumber, parseDesignSvgPathData,
  type DesignFreehandStyle, type DesignIconName, type DesignPathAnchor, type DesignPathGeometry, type DesignSvgGeometry, type DesignSvgMatrix,
  type DesignSvgPath, type DesignSvgViewBox, type DesignVectorGeometry,
} from './vector-geometry.js';
export {
  designFileKey, parseDesignWorkspace, commitDesignEdits, createDesignDocument, deleteDesignDocument, designImageExtensions, designImageFileExtensions, importDesignImage, importDesignScript,
  importDesignShader, listDesignDocuments, moveDesignDocument, navigateDesignHistory, readDesignDocument, readDesignScriptParameters, readDesignShader, renderDesignScript, resolveDesignDocumentRoot,
  type CommitDesignEditsInput, type CreateDesignDocumentInput, type DesignImageExtension,
  type DesignDocumentRef, type DesignSnapshot, type DesignWorkspace, type ImportDesignImageInput, type ImportDesignScriptInput, type MoveDesignDocumentInput, type NavigateDesignHistoryInput,
  type ImportDesignShaderInput, type ReadDesignScriptParametersInput, type ReadDesignShaderInput, type RenderDesignScriptInput,
} from './operations.js';

export const designFeature = defineFeature('design');

export const designFontStorageCapability = defineCapability<Readonly<{ dataDir: string }>>({
  id: 'design.font-storage',
  description: 'Store imported design fonts in the local runtime profile.',
});

export const designScriptSandboxCapability = defineCapability<Readonly<{
  evaluate(source: string, canvas: DesignScriptCanvas, signal: AbortSignal): Promise<unknown>;
}>>({
  id: 'design.script-sandbox',
  description: 'Evaluate canvas scripts with no host capabilities.',
});

export type DesignWorkspaceDocument = Readonly<{
  key: string;
  chatOrigin?(documentId: string): Promise<string | undefined>;
  linkedProject?(documentId: string): Promise<string | null | undefined>;
  read(): Promise<Readonly<{ content: string; revision: string }>>;
  replace(content: string, expectedRevision: string, previous: DesignDocument, next: DesignDocument): Promise<string>;
}>;

export { designDirectoryGrant, designDirectoryGrants, getDesignCatalog, setDesignProject, searchDesignImages, readDesignImage, type DesignDirectory, type DesignCatalog } from './design-storage.js';

export interface DesignWorkspaceFiles extends DesignStorage {
  projectDesigns(projectId: string, signal: AbortSignal): Promise<ProjectDesignEntry[]>;
  list(workspace: DesignWorkspace, signal: AbortSignal): Promise<readonly string[]>;
  create(input: CreateDesignDocumentInput, content: string, signal: AbortSignal, chat?: ChatDesignScope): Promise<WorkspaceEntry>;
  move(input: MoveDesignDocumentInput, signal: AbortSignal): Promise<DesignDocumentRef>;
  delete(ref: DesignDocumentRef & { expectedRevision?: string }, signal: AbortSignal): Promise<void>;
  resolveResourceRoot(ref: DesignDocumentRef, signal: AbortSignal): Promise<DesignDocumentRef>;
  importImage(ref: DesignDocumentRef, image: Readonly<{ name: string; extension: DesignImageExtension; bytes: Uint8Array }>,
    signal: AbortSignal): Promise<string>;
  importSource(ref: DesignDocumentRef, asset: Readonly<{ name: string; source: string; extension: 'js' | 'glsl' }>, signal: AbortSignal): Promise<string>;
  readSource(ref: DesignDocumentRef, assetPath: string, maxBytes: number, signal: AbortSignal): Promise<string>;
  withDocument<T>(
    ref: DesignDocumentRef, signal: AbortSignal, operation: (file: DesignWorkspaceDocument) => Promise<T>,
  ): Promise<T>;
}

export const designWorkspaceFilesCapability = defineCapability<DesignWorkspaceFiles>({
  id: 'design.workspace-files',
  description: 'Manage design files and their workspace assets.',
});
export { designTurnHostCapability, designToolsCapability, designToolNames, type DesignTurnHost, type DesignToolService } from './design-task.js';

export * from './chat-design.js';
export { designOwnerCodec } from './design-conversations.js';
export type { DesignConversationOwner, DesignConversation } from './design-conversations.js';
