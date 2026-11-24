import { isValidWorkspaceEntryName } from '@setsuna-desktop/contracts';
import { bundledDesignLibraryDocumentId, findBundledDesignLibrary } from './design-library-presets.js';

export const designDocumentFileExtension = 'design.json';
const suffix = `.${designDocumentFileExtension}`;

export function isDesignDocumentPath(path: string): boolean {
  return path.toLowerCase().endsWith(suffix);
}

export function designDocumentFileName(name: string): string {
  return isDesignDocumentPath(name) ? name : `${name}${suffix}`;
}

export function parseDesignLibraryPath(value: unknown): string {
  const preset = findBundledDesignLibrary(value);
  if (preset) return preset.bundledPath;
  if (typeof value !== 'string' || !isDesignDocumentPath(value) || !value.split('/').every(isValidWorkspaceEntryName)) {
    throw new Error('A design library requires a bundled preset or a .design.json path within the resource root.');
  }
  return value;
}

export function parseDesignId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/u.test(value)) throw new Error('Invalid design layer ID.');
  return value;
}

export function parseDesignLibraryLink(id: unknown, source: unknown) {
  const documentId = parseDesignId(id);
  const path = parseDesignLibraryPath(source);
  const preset = findBundledDesignLibrary(path);
  if (preset && documentId !== bundledDesignLibraryDocumentId(preset.id)) throw new Error('The bundled design library ID is invalid.');
  return { documentId, path };
}

export function designResourceId(documentId: string, id: string): string {
  return `${documentId}:${id}`;
}

export function designResourceParts(value: string) {
  const separator = value.indexOf(':');
  return separator === -1 ? undefined : { documentId: value.slice(0, separator), id: value.slice(separator + 1) };
}

export function parseDesignResourceId(value: unknown): string {
  const parts = typeof value === 'string' ? designResourceParts(value) : undefined;
  if (!parts) return parseDesignId(value);
  return designResourceId(parseDesignId(parts.documentId), parseDesignId(parts.id));
}
