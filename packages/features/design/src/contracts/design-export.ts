import type { DesignPackagePreview, DesignSavedVersion } from './design-package.js';

export type DesignLayerExport = Readonly<{ kind: 'html' | 'svg' | 'png'; name: string; content: string }>;
export type DesignExportInput = DesignLayerExport | Readonly<{ kind: 'zip'; version: DesignSavedVersion }>;

export type DesignPreparedExport = Readonly<{ name: string; archive?: DesignPackagePreview }>;
export type DesignExportFileAction = 'save' | 'open' | 'reveal';
