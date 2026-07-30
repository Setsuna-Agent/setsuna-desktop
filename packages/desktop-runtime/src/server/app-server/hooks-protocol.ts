import type { RuntimeHookListResponse } from '@setsuna-desktop/contracts';
import { listRuntimeHooks } from '../../runtime/use-cases/capability-operations.js';
import type { RuntimeFactory } from '../types.js';
import { recordInput } from './input.js';

export async function appServerHooksListResponse(
  runtime: RuntimeFactory,
  params: unknown,
): Promise<RuntimeHookListResponse> {
  const input = recordInput(params);
  return listRuntimeHooks(runtime, input.cwds);
}
