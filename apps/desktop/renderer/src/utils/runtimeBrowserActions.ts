import {
  OPEN_BROWSER_TOOL_NAME,
  parseRuntimeBrowserOpenAction,
  type RuntimeEvent,
} from '@setsuna-desktop/contracts';

export type BrowserOpenRequest = {
  id: string;
  url: string;
};

export function browserOpenRequestFromEvent(event: RuntimeEvent): BrowserOpenRequest | null {
  if (
    event.type !== 'tool.completed'
    || event.payload.toolName !== OPEN_BROWSER_TOOL_NAME
    || event.payload.status !== 'success'
  ) return null;
  const action = parseRuntimeBrowserOpenAction(event.payload.data);
  return action ? { id: event.id, url: action.url } : null;
}

export function latestBrowserOpenRequest(events: RuntimeEvent[]): BrowserOpenRequest | null {
  for (const event of events) {
    const request = browserOpenRequestFromEvent(event);
    if (request) return request;
  }
  return null;
}
