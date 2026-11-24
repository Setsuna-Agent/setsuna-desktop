export const designLibraryPresets = [
  {
    id: 'shadcn-ui', name: 'shadcn/ui', homepage: 'https://ui.shadcn.com/',
    fileName: 'Setsuna shadcn-ui.design.json', bundledPath: 'builtin:shadcn-ui',
  },
  {
    id: 'beui', name: 'beUI', homepage: 'https://beui.dev/',
    fileName: 'Setsuna beUI.design.json', bundledPath: 'builtin:beui',
  },
] as const;

export type DesignLibraryPresetId = (typeof designLibraryPresets)[number]['id'];
export type DesignLibraryColorScheme = 'light' | 'dark';
export const designLibraryDarkModeId = 'dark';
const presetDocumentPrefix = 'setsuna-library-';
const presetCopyId = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;

export function designLibraryPresetIdPrefix(id: DesignLibraryPresetId): string {
  return `${presetDocumentPrefix}${id}-`;
}

export function bundledDesignLibraryDocumentId(id: DesignLibraryPresetId): string {
  return `${designLibraryPresetIdPrefix(id)}bundled`;
}

export function findBundledDesignLibrary(path: unknown) {
  return designLibraryPresets.find(({ bundledPath }) => bundledPath === path);
}

export function designLibraryFileLinks(libraries?: Readonly<Record<string, string>>) {
  return Object.entries(libraries ?? {}).filter(([, path]) => !findBundledDesignLibrary(path));
}

export function isDesignLibraryPresetDocumentId(documentId: string | undefined, presetId?: DesignLibraryPresetId): boolean {
  if (!documentId) return false;
  return designLibraryPresets.some(({ id }) => {
    if (presetId && id !== presetId) return false;
    const prefix = designLibraryPresetIdPrefix(id);
    if (!documentId.startsWith(prefix)) return false;
    const suffix = documentId.slice(prefix.length);
    return suffix === 'bundled' || presetCopyId.test(suffix);
  });
}
