import type { AssistantConnectorState } from '../contracts/index.js';

/** The avatar's owner provides the connection label through its tooltip and accessible name. */
export function AssistantConnectionDot({ state }: { state: AssistantConnectorState }) {
  return <span className="assistant-connection-dot" data-state={state} aria-hidden="true" />;
}
