import type { ComponentRenderProps, ComponentRenderer } from '@openuidev/react-lang';
import { Component, createContext, useContext, type ReactNode } from 'react';

type FailureContext = { source: string; onRenderError: (source: string) => void };
export const OpenUiFailureContext = createContext<FailureContext>({ source: '', onRenderError: () => undefined });

export function withOpenUiComponentBoundary(Render: ComponentRenderer): ComponentRenderer {
  return function PresentationComponent(props: ComponentRenderProps) {
    const failure = useContext(OpenUiFailureContext);
    return <ComponentBoundary {...failure}><Render {...props} /></ComponentBoundary>;
  };
}

// Upstream suppresses render errors during streaming and may never report them
// on completion. Catch inside its boundary so a failed final block always falls back.
class ComponentBoundary extends Component<FailureContext & { children: ReactNode }, { source: string; failed: boolean }> {
  state = { source: this.props.source, failed: false };

  static getDerivedStateFromProps(props: FailureContext, state: { source: string }) {
    return props.source === state.source ? null : { source: props.source, failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onRenderError(this.props.source);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
