import type {
  ModelRequest,
  ModelStreamEvent,
  RuntimeMessageProviderMetadata,
  RuntimeUsage,
} from '@setsuna-desktop/contracts';

export type ModelCompactionRequest = Pick<ModelRequest, 'model' | 'providerId' | 'messages' | 'signal'>;

export type ModelCompactionResult =
  | {
      kind: 'summary';
      summary: string;
      usage?: RuntimeUsage;
    }
  | {
      kind: 'native';
      providerMetadata: RuntimeMessageProviderMetadata;
      usage?: RuntimeUsage;
    };

export type ModelClient = {
  compactConversation?(request: ModelCompactionRequest): Promise<ModelCompactionResult>;
  stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent>;
};
