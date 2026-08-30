import { Component, type ErrorInfo, type ReactNode } from 'react';

type RendererSlotErrorBoundaryProps = Readonly<{
  children: ReactNode;
  fallback(error: Error, reset: () => void): ReactNode;
  identity: string;
  onError(error: Error): void;
  onReset(): void;
  resetKey: string;
}>;

type RendererSlotErrorBoundaryState = Readonly<{
  error: Error | null;
  resetKey: string;
}>;

export class RendererSlotErrorBoundary extends Component<
  RendererSlotErrorBoundaryProps,
  RendererSlotErrorBoundaryState
> {
  state: RendererSlotErrorBoundaryState = {
    error: null,
    resetKey: this.props.resetKey,
  };

  private readonly reset = () => {
    this.props.onReset();
    this.setState({ error: null, resetKey: this.props.resetKey });
  };

  static getDerivedStateFromError(error: Error): Partial<RendererSlotErrorBoundaryState> {
    return { error };
  }

  static getDerivedStateFromProps(
    props: RendererSlotErrorBoundaryProps,
    state: RendererSlotErrorBoundaryState,
  ): Partial<RendererSlotErrorBoundaryState> | null {
    if (props.resetKey === state.resetKey) return null;
    return { error: null, resetKey: props.resetKey };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError(error);
    console.error(`[RendererSlot:${this.props.identity}]`, error, info.componentStack);
  }

  render(): ReactNode {
    return this.state.error ? this.props.fallback(this.state.error, this.reset) : this.props.children;
  }
}
