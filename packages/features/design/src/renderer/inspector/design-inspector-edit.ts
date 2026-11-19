import type { DesignLayout, DesignNode } from '../../contracts/index.js';
import type { Point } from '../design-geometry.js';
import type { DesignSegmentMeasurements } from '../vectors/design-path-edit.js';

export type DesignNodeEdit = (node: DesignNode) => DesignNode;
export type DesignFieldUpdates = ReadonlyMap<string, DesignNodeEdit>;
export type InspectorFieldEdits = Readonly<{
  onFieldSave(edit: DesignNodeEdit): Promise<boolean>;
  onFieldPreview(owner: string, edit: DesignNodeEdit | undefined): void;
}>;

export type InspectorCanvasPreview = Readonly<{
  id: string; revision: string; x: number; y: number; width: number; height: number; rotation: number;
  layout?: DesignLayout; crop?: Point; segment?: DesignSegmentMeasurements;
}>;

export function bindDesignValue<T>(edits: InspectorFieldEdits, apply: (node: DesignNode, value: T) => DesignNode) {
  return {
    onSave: (value: T) => edits.onFieldSave((node) => apply(node, value)),
    onPreview: (value: T | undefined, owner: string) =>
      edits.onFieldPreview(owner, value === undefined ? undefined : (node) => apply(node, value)),
  };
}

export const bindDesignNumber = bindDesignValue<number>;

export function previewDesignNode(edits: InspectorFieldEdits) {
  return bindDesignValue(edits, (_, next: DesignNode) => next).onPreview;
}

export function bindDesignText(edits: InspectorFieldEdits, apply: (node: DesignNode, value: string) => DesignNode) {
  const { onSave, onPreview } = bindDesignValue(edits, apply);
  return { onSave, onDraft: onPreview };
}

export function designOptionEdits<T extends string | number>(options: readonly T[], { onSave, onPreview }: Readonly<{
  onSave(value: T): void | Promise<boolean>;
  onPreview?(value: T | undefined, owner: string): void;
}>) {
  const optionFor = (value: string | undefined) => value === undefined ? undefined : options.find((option) => String(option) === value);
  return {
    onValueChange: (value: string) => {
      const option = optionFor(value);
      if (option !== undefined) void onSave(option);
    },
    onValuePreview: onPreview && ((value: string | undefined, owner: string) => onPreview(optionFor(value), owner)),
  };
}
