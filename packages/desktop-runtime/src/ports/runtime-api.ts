import type { RuntimeApiRequest, RuntimeApiResponse } from '@setsuna-desktop/contracts';

/** The server supplies the authenticated local transport after composition. */
export interface RuntimeApi {
  request(input: RuntimeApiRequest, signal?: AbortSignal): Promise<RuntimeApiResponse>;
}
