import type { FeatureOperationTransport } from '@setsuna-desktop/feature-core/operation';
import {
  listRuntimeActivities,
  listRuntimeActivityServices,
  stopRuntimeActivityService,
  stopRuntimeActivityTask,
  type RuntimeActivityList,
  type RuntimeActivityServiceList,
  type RuntimeActivityServiceListTarget,
  type RuntimeActivityServiceTarget,
  type RuntimeActivityTaskTarget,
  type RuntimeActivityTaskTermination,
} from '../contracts/index.js';
import type { RuntimeBackgroundShellProcessTermination } from '@setsuna-desktop/contracts';

export type RuntimeActivityClient = Readonly<{
  list(options?: Readonly<{ signal?: AbortSignal }>): Promise<RuntimeActivityList>;
  listServices(
    input: RuntimeActivityServiceListTarget,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<RuntimeActivityServiceList>;
  stopService(
    input: RuntimeActivityServiceTarget,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<RuntimeBackgroundShellProcessTermination>;
  stopTask(
    input: RuntimeActivityTaskTarget,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<RuntimeActivityTaskTermination>;
}>;

export function createRuntimeActivityClient(
  transport: FeatureOperationTransport,
): RuntimeActivityClient {
  return Object.freeze({
    list: (options) => transport.call(listRuntimeActivities, undefined, options),
    listServices: (input, options) => transport.call(listRuntimeActivityServices, input, options),
    stopService: (input, options) => transport.call(stopRuntimeActivityService, input, options),
    stopTask: (input, options) => transport.call(stopRuntimeActivityTask, input, options),
  });
}
