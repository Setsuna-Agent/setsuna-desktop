import { defineCapability, type CapabilityToken } from '@setsuna-desktop/feature-core/capability';
import type {
  DesktopCommitMessageGenerationSource,
  DesktopReviewFilePreviewResult,
} from './bridge.js';

export interface ReviewCommitMessageGenerator {
  generate(source: DesktopCommitMessageGenerationSource, options?: {
    signal?: AbortSignal;
    onProgress?: (message: string) => void;
  }): Promise<string>;
}

export interface ReviewFilePreviewRegistry {
  createWorkspacePreview(workspaceRoot: string, filePath: string): Promise<DesktopReviewFilePreviewResult>;
  registerContentPreview(input: Readonly<{
    content: Uint8Array;
    mimeType: string;
    name: string;
  }>): Readonly<{ previewId: string; url: string }>;
  registerHtmlPreview(input: Readonly<{
    filePath: string;
    content: string;
    readResource(filePath: string): Promise<Uint8Array | null>;
  }>): Readonly<{ previewId: string; url: string }>;
  release(previewId: string): boolean;
}

export interface ReviewRendererSenderPolicy {
  isAllowed(senderId: number): boolean;
}

export const reviewCommitMessageCapability: CapabilityToken<ReviewCommitMessageGenerator> = defineCapability({
  id: 'desktop-review.commit-message',
  description: 'Host-backed commit message generation for native review actions',
});

export const reviewFilePreviewCapability: CapabilityToken<ReviewFilePreviewRegistry> = defineCapability({
  id: 'desktop-review.file-previews',
  description: 'Host-owned file preview registrations for review images and HTML documents',
});

export const reviewRendererSenderCapability: CapabilityToken<ReviewRendererSenderPolicy> = defineCapability({
  id: 'desktop-review.renderer-sender',
  description: 'Host policy for authenticating Review IPC senders',
});
