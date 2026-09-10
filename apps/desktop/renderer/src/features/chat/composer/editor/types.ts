import type { ReactNode } from 'react';

/** Editor content belongs to Chat, independent of the visual component library. */
export type ComposerSlot =
  | { type: 'text'; value?: string; key?: string }
  | { type: 'tag'; key: string; props: { label?: ReactNode; value?: string } };

export type ComposerEditor = {
  readonly inputElement: HTMLDivElement | null;
  focus(options?: { cursor?: 'start' | 'end' | 'all'; preventScroll?: boolean }): void;
  getValue(): { value: string; slotConfig: ComposerSlot[] };
  clear(): void;
  insert(slots: ComposerSlot[], position?: 'start' | 'end' | 'cursor', replaceCharacters?: string, preventScroll?: boolean): void;
};
