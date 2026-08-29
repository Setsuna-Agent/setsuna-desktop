import type {
  ReviewRendererService,
  StartReviewInput,
} from '../contracts/index.js';
import type { ReviewClient } from './client.js';

export class RendererReviewService implements ReviewRendererService {
  readonly available = true;

  constructor(private readonly client: Pick<ReviewClient, 'start'>) {}

  start(
    input: StartReviewInput,
    options?: Readonly<{ signal?: AbortSignal }>,
  ) {
    return this.client.start(input, options);
  }
}
