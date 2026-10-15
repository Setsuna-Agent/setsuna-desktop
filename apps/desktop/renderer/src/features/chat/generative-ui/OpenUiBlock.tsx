import { Component, lazy, memo, Suspense, type ReactNode } from 'react';
import { MarkdownCodeBlock } from '../markdown/MarkdownCodeBlock.js';

const OpenUiRenderer = lazy(() => import('./OpenUiRenderer.js'));

export type OpenUiBlockProps = { code: string; streaming: boolean };

export const OpenUiBlock = memo(function OpenUiBlock({ code, streaming }: OpenUiBlockProps) {
  return (
    <OpenUiErrorBoundary code={code}>
      <Suspense fallback={null}>
        <OpenUiRenderer code={code} streaming={streaming} />
      </Suspense>
    </OpenUiErrorBoundary>
  );
});

class OpenUiErrorBoundary extends Component<{ children: ReactNode; code: string }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidUpdate(previous: { code: string }) {
    if (this.state.failed && previous.code !== this.props.code) this.setState({ failed: false });
  }

  render() {
    return this.state.failed
      ? <MarkdownCodeBlock code={this.props.code} language="openui" />
      : this.props.children;
  }
}
