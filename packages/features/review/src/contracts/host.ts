import { defineCapability, type CapabilityToken } from '@setsuna-desktop/feature-core/capability';
import type {
  DesktopCommitMessageGenerationSource,
  DesktopReviewImagePreviewResult,
} from './bridge.js';

export interface ReviewCommitMessageGenerator {
  generate(source: DesktopCommitMessageGenerationSource): Promise<string>;
}

export interface ReviewFilePreviewRegistry {
  createWorkspacePreview(workspaceRoot: string, filePath: string): Promise<DesktopReviewImagePreviewResult>;
  registerContentPreview(input: Readonly<{
    content: Uint8Array;
    mimeType: string;
    name: string;
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
  description: 'Host-owned authenticated file preview registrations for review images',
});

export const reviewRendererSenderCapability: CapabilityToken<ReviewRendererSenderPolicy> = defineCapability({
  id: 'desktop-review.renderer-sender',
  description: 'Host policy for authenticating Review IPC senders',
});
