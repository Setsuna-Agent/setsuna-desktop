import type { ModelRequest, ModelStreamEvent, RuntimeUsage } from '@setsuna-desktop/contracts';

export type ModelCompactionRequest = Pick<ModelRequest, 'model' | 'messages' | 'tools' | 'maxOutputTokens' | 'temperature' | 'signal'>;

export type ModelCompactionResult = {
  summary: string;
  usage?: RuntimeUsage;
};

export type ModelClient = {
  compactConversation?(request: ModelCompactionRequest): Promise<ModelCompactionResult>;
  stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent>;
};
