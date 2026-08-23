import { Component, type ErrorInfo, type ReactNode } from 'react';

type FeatureContributionBoundaryProps = Readonly<{
  children: ReactNode;
  featureId: string;
  fallback(reset: () => void): ReactNode;
  resetKey: string;
}>;

type FeatureContributionBoundaryState = Readonly<{ failed: boolean }>;

/** Keeps a single Feature contribution from taking down its host page or message list. */
export class FeatureContributionBoundary extends Component<
  FeatureContributionBoundaryProps,
  FeatureContributionBoundaryState
> {
  state: FeatureContributionBoundaryState = { failed: false };

  static getDerivedStateFromError(): FeatureContributionBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, _info: ErrorInfo): void {
    // Do not log props, payloads, component stacks, or arbitrary error text from a Feature view.
    console.error('[renderer-feature] Contribution render failed.', {
      featureId: this.props.featureId,
      errorName: error.name,
    });
  }

  componentDidUpdate(previous: FeatureContributionBoundaryProps): void {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  private readonly reset = () => {
    this.setState({ failed: false });
  };

  render(): ReactNode {
    return this.state.failed ? this.props.fallback(this.reset) : this.props.children;
  }
}
