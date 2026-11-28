import type { CreateDesignDocumentInput } from '../../contracts/operations.js';
import type { DesignFontClient } from '../client.js';

export type DesignImportSource = Readonly<{
  kind: 'package';
  name: string;
  file: File;
}> | Readonly<{
  kind: 'pencil';
  name: string;
  size: number;
  read(fonts?: Pick<DesignFontClient, 'list' | 'read'>): Promise<NonNullable<CreateDesignDocumentInput['initialLayers']>>;
}>;

export function designImportSource(file: File): DesignImportSource | undefined {
  const dot = file.name.lastIndexOf('.');
  if (dot < 0) return;
  const extension = file.name.slice(dot).toLowerCase();
  const name = file.name.slice(0, dot);
  if (extension === '.zip') return { kind: 'package', name, file };
  if (extension !== '.pen') return;
  return {
    kind: 'pencil',
    name,
    size: file.size,
    async read(fonts) {
      const { importPencilLayers } = await import('./pencil/document.js');
      return importPencilLayers(await file.text(), fonts);
    },
  };
}
