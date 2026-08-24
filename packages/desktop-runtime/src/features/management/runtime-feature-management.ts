import type { RuntimeFeatureComposition } from '@setsuna-desktop/feature-core/runtime';

export class RuntimeFeatureManagement {
  private composition: RuntimeFeatureComposition | null = null;

  attach(composition: RuntimeFeatureComposition): () => void {
    if (this.composition && this.composition !== composition) {
      throw new Error('Runtime Feature composition is already attached.');
    }
    this.composition = composition;
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      if (this.composition === composition) this.composition = null;
    };
  }

  statuses() {
    return this.composition?.statuses() ?? [];
  }
}
