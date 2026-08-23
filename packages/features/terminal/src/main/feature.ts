import { requiredCapability } from '@setsuna-desktop/feature-core/capability';
import { defineMainDependencies, defineMainFeature } from '@setsuna-desktop/feature-core/main';
import {
  terminalEnvironmentCapability,
  terminalEventPublisherCapability,
  terminalFeature,
} from '../contracts/index.js';
import { registerTerminalIpc } from './ipc.js';
import { DesktopTerminalStore } from './sessions.js';

const dependencies = defineMainDependencies({
  environment: requiredCapability(terminalEnvironmentCapability),
  events: requiredCapability(terminalEventPublisherCapability),
});

export const terminalMainFeature = defineMainFeature({
  definition: terminalFeature,
  dependencies,
  setup(context) {
    const terminal = new DesktopTerminalStore(
      (event) => context.dependencies.events.publish(event),
      () => context.dependencies.environment.resolve(),
    );
    // Stop accepting renderer work before closing every native PTY during drain.
    context.scope.add(() => terminal.closeAll());
    context.scope.add(registerTerminalIpc(terminal));
  },
});
