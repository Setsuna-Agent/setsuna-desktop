import {
  createNoopReviewControl,
  type ReviewControl,
  type ReviewSettingsState,
  type ReviewSettingsUpdate,
  type ReviewStartOutcome,
  type StartReviewInput,
} from '@setsuna-desktop/feature-review/contracts';

/** Stable compatibility-adapter facade bound after the required Review Feature activates. */
export class BindableReviewControl implements ReviewControl {
  private control: ReviewControl = createNoopReviewControl();

  get available(): boolean {
    return this.control.available;
  }

  bind(control: ReviewControl): () => void {
    if (this.control.available && this.control !== control) {
      throw new Error('Review control is already bound.');
    }
    this.control = control;
    return () => {
      if (this.control === control) this.control = createNoopReviewControl();
    };
  }

  readSettings(): Promise<ReviewSettingsState> {
    return this.control.readSettings();
  }

  start(input: StartReviewInput): Promise<ReviewStartOutcome> {
    return this.control.start(input);
  }

  updateSettings(input: ReviewSettingsUpdate): Promise<ReviewSettingsState> {
    return this.control.updateSettings(input);
  }
}
