import type { FeatureOperationTransport } from '@setsuna-desktop/feature-core/operation';
import {
  createSideConversation,
  type CreateSideConversationResult,
} from '../contracts/index.js';

export interface SideConversationClient {
  create(
    parentThreadId: string,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<CreateSideConversationResult>;
}

export function createSideConversationClient(
  transport: FeatureOperationTransport,
): SideConversationClient {
  return Object.freeze({
    create: (
      parentThreadId: string,
      options?: Readonly<{ signal?: AbortSignal }>,
    ) => (
      transport.call(createSideConversation, { parentThreadId }, options)
    ),
  });
}
