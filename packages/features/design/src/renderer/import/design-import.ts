import type { CreateDesignDocumentInput } from '../../contracts/operations.js';
import type { DesignFontClient } from '../client.js';

export type DesignImportSource = Readonly<{
  name: string;
  size: number;
  read(fonts?: Pick<DesignFontClient, 'list' | 'read'>): Promise<NonNullable<CreateDesignDocumentInput['initialLayers']>>;
}>;

export function designImportSource(file: File): DesignImportSource | undefined {
  const dot = file.name.lastIndexOf('.');
  if (dot < 0 || file.name.slice(dot).toLowerCase() !== '.pen') return;
  return {
    name: file.name.slice(0, dot),
    size: file.size,
    async read(fonts) {
      const { importPencilLayers } = await import('./pencil/document.js');
      return importPencilLayers(await file.text(), fonts);
    },
  };
}
