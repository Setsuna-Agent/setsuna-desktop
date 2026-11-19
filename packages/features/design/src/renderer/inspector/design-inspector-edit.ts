import type { DesignLayout, DesignNode } from '../../contracts/index.js';
import type { Point } from '../design-geometry.js';

export type DesignNumberEdit = (node: DesignNode) => DesignNode;
export type InspectorNumberEdits = Readonly<{
  onNumberSave(edit: DesignNumberEdit): Promise<boolean>;
  onNumberPreview(owner: string, edit: DesignNumberEdit | undefined): void;
}>;

export type InspectorCanvasPreview = Readonly<{
  id: string; revision: string; x: number; y: number; width: number; height: number; rotation: number;
  layout?: DesignLayout; crop?: Point;
}>;

export function bindDesignNumber(edits: InspectorNumberEdits, apply: (node: DesignNode, value: number) => DesignNode) {
  return {
    onSave: (value: number) => edits.onNumberSave((node) => apply(node, value)),
    onPreview: (value: number | undefined, owner: string) =>
      edits.onNumberPreview(owner, value === undefined ? undefined : (node) => apply(node, value)),
  };
}
