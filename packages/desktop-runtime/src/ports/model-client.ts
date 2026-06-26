import type { ModelRequest, ModelStreamEvent } from '@setsuna-desktop/contracts';

export type ModelClient = {
  stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent>;
};

