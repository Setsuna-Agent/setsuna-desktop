import type {
  ModelCompactionRequest,
  ModelCompactionResult,
  ModelRequest,
  ModelStreamEvent,
} from '@setsuna-desktop/contracts';

export type { ModelCompactionRequest, ModelCompactionResult } from '@setsuna-desktop/contracts';

export type ModelClient = {
  compactConversation?(request: ModelCompactionRequest): Promise<ModelCompactionResult>;
  stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent>;
};
