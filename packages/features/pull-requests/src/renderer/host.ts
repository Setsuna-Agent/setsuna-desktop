import { defineCapability } from '@setsuna-desktop/feature-core/capability';
import type { ComponentType, ReactNode, RefObject } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import type { SettingsPageHeaderProps } from '@setsuna-desktop/renderer-contracts/settings';
import type { FileDiff, PostRenderPhase } from '@pierre/diffs';
import type { DiffLineAnnotation } from '@pierre/diffs/react';
import type { PullRequestQuoteReference } from './discussions/quote.js';

export type PullRequestPatchViewProps = {
  patch: string; layout?: 'split' | 'unified'; wrap?: boolean; className?: string;
  lineAnnotations?: DiffLineAnnotation<ReactNode>[];
  onPostRender?: (node: HTMLElement, instance: FileDiff<ReactNode>, phase: PostRenderPhase) => unknown;
};
export type PullRequestCommentInputProps = {
  value: string; label: string; placeholder: string; disabled: boolean; maxLength: number;
  quotes?: PullRequestQuoteReference[];
  focusRequest?: number; footer: ReactNode;
  onChange(value: string, quotes?: PullRequestQuoteReference[]): void; onSubmit(): void;
};
export type PullRequestsRendererHost = {
  PageHeader: ComponentType<SettingsPageHeaderProps>;
  Markdown: ComponentType<{ content: string; baseUrl: string }>;
  CodePatch: ComponentType<PullRequestPatchViewProps>;
  CommentInput: ComponentType<PullRequestCommentInputProps>;
  ScrollOverlay: ComponentType<{ scrollRef: RefObject<HTMLDivElement | null>; disabled?: boolean }>;
  openExternal(url: string): Promise<boolean>;
  copyText(text: string): Promise<void>;
  notifyError(message: string): void;
  translate: RendererTranslate;
  locale: string;
};
export const pullRequestsRendererHostCapability = defineCapability<ComponentType<{ children(host: PullRequestsRendererHost): ReactNode }>>({
  id: 'pull-requests.renderer-host', description: 'Shared Markdown, code diff, localization and external links',
});
