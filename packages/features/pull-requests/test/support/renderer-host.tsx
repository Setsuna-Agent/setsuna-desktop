import type { ReactNode } from 'react';
import type { PullRequestsRendererHost } from '../../src/renderer/host.js';
import { PullRequestsHostContext } from '../../src/renderer/context.js';

export const rendererHost: PullRequestsRendererHost = {
  Markdown: ({ content }) => <div>{content}</div>,
  PageHeader: ({ title }) => <h2>{title}</h2>,
  CodePatch: ({ patch }) => <pre>{patch}</pre>,
  ScrollOverlay: () => null,
  CommentInput: ({ value, label, disabled, onChange, footer }) => <>
    <textarea aria-label={label} value={value} disabled={disabled} onChange={(event) => onChange(event.currentTarget.value)} />{footer}
  </>,
  translate: (key) => key.replace('feature.pullRequests.', ''),
  locale: 'en', openExternal: async () => true, copyText: async () => undefined, notifyError: () => undefined,
};
export function RendererHost({ children }: { children: ReactNode }) {
  return <PullRequestsHostContext.Provider value={rendererHost}>{children}</PullRequestsHostContext.Provider>;
}
