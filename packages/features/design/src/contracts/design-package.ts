import { isValidWorkspaceEntryName, workspaceTemporaryDirectoryPrefix } from '@setsuna-desktop/contracts';
import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';
import { defineFeatureOperation } from '@setsuna-desktop/feature-core/operation';
import { parseDesignDocumentRef, parseDesignWorkspace, type DesignDocumentRef, type DesignWorkspace } from './operations.js';
import { parseDesignId } from './design-resource-id.js';
import { parseAssetPath } from './document.js';

export type DesignSavedVersion = Readonly<{ ref: DesignDocumentRef; documentId: string; expectedRevision: string }>;
export type PrepareDesignPackageInput = DesignSavedVersion & Readonly<{ ticket: string }>;
export type DesignPackageDestination = Readonly<{ scope: DesignWorkspace; name: string; linkedProjectId?: string }>;
export type ImportDesignPackageInput = Readonly<{ destination: DesignPackageDestination; ticket: string }>;

export function isDesignSavedRevision(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

export function parseDesignSavedVersion(value: unknown): DesignSavedVersion {
  const input = value as Partial<DesignSavedVersion> | null;
  if (!isDesignSavedRevision(input?.expectedRevision)) {
    throw new Error('A saved design revision is required.');
  }
  const ref = parseDesignDocumentRef(input.ref);
  parseAssetPath(ref.path);
  return { ref, documentId: parseDesignId(input.documentId), expectedRevision: input.expectedRevision };
}

export function isDesignDeliveryTicket(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u.test(value);
}

export const designPackageStagingPrefix = '.design-package-';
export const designPackageImportStagingPrefix = '.design-package-import-';
export const designPackageStagingFile = 'package.zip';
export const designPackageManifestFile = 'manifest.json';
export const designPackageResourceRoot = 'content';
export const designPackageContentPrefix = designPackageResourceRoot + '/';
export const maxDesignPackageFiles = 16_000;
export const maxDesignPackageContentBytes = 2 * 1024 ** 3;
export const maxDesignPackageManifestBytes = 32 * 1024 ** 2;
export const maxDesignPackageArchiveBytes = maxDesignPackageContentBytes + 256 * 1024 ** 2;
export const maxDesignPackagePreviewEntries = 128;

export type DesignPackagePreview = Readonly<{ entries: readonly string[]; remaining: number }>;
export type DesignPackageReceipt = Readonly<{ ticket: string; archive: DesignPackagePreview }>;

export const prepareDesignPackage = defineFeatureOperation({
  id: 'design.document.prepare-package', path: '/v1/features/design/documents/package', method: 'POST',
  input: defineRuntimeCodec<PrepareDesignPackageInput>((value) => {
    const ticket = (value as Partial<PrepareDesignPackageInput> | null)?.ticket;
    if (!isDesignDeliveryTicket(ticket)) throw new Error('Invalid design package ticket.');
    return { ...parseDesignSavedVersion(value), ticket };
  }),
  output: defineRuntimeCodec<DesignPackageReceipt>((value) => {
    const receipt = value as Partial<DesignPackageReceipt> | null;
    const archive = receipt?.archive;
    if (!isDesignDeliveryTicket(receipt?.ticket) || !archive || !Array.isArray(archive.entries)
      || archive.entries.length > maxDesignPackagePreviewEntries || !archive.entries.every((entry) => typeof entry === 'string')
      || !Number.isSafeInteger(archive.remaining) || archive.remaining < 0) throw new Error('Invalid design package receipt.');
    return { ticket: receipt.ticket, archive: { entries: archive.entries, remaining: archive.remaining } };
  }),
  errors: {
    DESIGN_NOT_FOUND: { status: 404 },
    INVALID_DESIGN_DOCUMENT: { status: 422 },
    REVISION_CONFLICT: { status: 409 },
    DESIGN_RESOURCE_ROOT_UNAVAILABLE: { status: 409 },
    DESIGN_RESOURCE_ROOT_AMBIGUOUS: { status: 409 },
    DESIGN_DEPENDENCY_UNAVAILABLE: { status: 409 },
    DESIGN_PACKAGE_INVALID_PATH: { status: 422 },
    DESIGN_PACKAGE_TOO_LARGE: { status: 413 },
  },
  idempotency: 'non-idempotent',
});

export function isPortableDesignPackagePathPart(value: unknown): value is string {
  return isValidWorkspaceEntryName(value) && !/^(?:conin\$|conout\$|(?:com|lpt)[¹²³])(?:\.|$)/iu.test(value);
}

export function isDesignPackageFolderName(value: unknown): value is string {
  return isPortableDesignPackagePathPart(value) && !value.startsWith(workspaceTemporaryDirectoryPrefix)
    && new TextEncoder().encode(value).byteLength <= 240;
}

export function parseDesignPackageDestination(value: unknown): DesignPackageDestination {
  const destination = value as Partial<DesignPackageDestination> | null;
  if (!destination || !isDesignPackageFolderName(destination.name)
    || (destination.linkedProjectId !== undefined && (typeof destination.linkedProjectId !== 'string' || !destination.linkedProjectId))) {
    throw new Error('Invalid design package destination.');
  }
  return { scope: parseDesignWorkspace(destination.scope), name: destination.name, linkedProjectId: destination.linkedProjectId };
}

export const importDesignPackage = defineFeatureOperation({
  id: 'design.document.import-package', path: '/v1/features/design/documents/import-package', method: 'POST',
  input: defineRuntimeCodec<ImportDesignPackageInput>((value) => {
    const input = value as Partial<ImportDesignPackageInput> | null;
    if (!input || !isDesignDeliveryTicket(input.ticket)) throw new Error('Invalid design package ticket.');
    return { destination: parseDesignPackageDestination(input.destination), ticket: input.ticket };
  }),
  output: defineRuntimeCodec<DesignDocumentRef>(parseDesignDocumentRef),
  errors: {
    DESIGN_PACKAGE_INVALID: { status: 422 },
    DESIGN_PACKAGE_INVALID_PATH: { status: 422 },
    DESIGN_PACKAGE_TOO_LARGE: { status: 413 },
    DESIGN_DEPENDENCY_UNAVAILABLE: { status: 422 },
  },
  idempotency: 'non-idempotent',
});

export function isDesignPackageTransferPath(path: string): boolean {
  return path === prepareDesignPackage.path || path === importDesignPackage.path;
}

export type DesignPackageManifest = Readonly<{
  formatVersion: 1;
  entry: string;
  resourceRoot: typeof designPackageResourceRoot;
  externalDependencies: Readonly<{
    webUrls: readonly string[];
    builtinLibraries: readonly Readonly<{ path: string; documentId: string; revision: string }>[];
    fonts: Readonly<{ source: 'environment'; declaredFamilies: readonly string[] }>;
  }>;
}>;
