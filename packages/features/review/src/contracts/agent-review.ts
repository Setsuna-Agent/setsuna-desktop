import type {
  RuntimeConfiguredModelReference,
  RuntimeInterfaceLanguage,
} from '@setsuna-desktop/contracts';

export type ReviewTarget =
  | Readonly<{ type: 'uncommittedChanges' }>
  | Readonly<{ type: 'baseBranch'; branch: string }>
  | Readonly<{ type: 'commit'; sha: string; title?: string }>
  | Readonly<{ type: 'custom'; instructions: string }>;

export type StartReviewInput = Readonly<{
  threadId: string;
  language?: RuntimeInterfaceLanguage;
  modelSelection?: RuntimeConfiguredModelReference;
  target: ReviewTarget;
}>;

export type StartReviewResult = Readonly<{
  accepted: true;
  turnId: string;
}>;

/** Feature-owned request passed through the narrow runtime host into Core turn scheduling. */
export type ReviewTurnRequest = Readonly<{
  /** Conversation model retained for thread binding and persistent context compaction. */
  conversationModelSelection?: RuntimeConfiguredModelReference;
  developerInstructions: string;
  displayText: string;
  language: RuntimeInterfaceLanguage;
  modelSelection?: RuntimeConfiguredModelReference;
  prompt: string;
}>;

export type ReviewStartOutcome = Readonly<{
  request: ReviewTurnRequest;
  response: StartReviewResult;
}>;
