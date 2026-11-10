import type { MainView } from './types.js';

/** Feature routes that borrow the conversation surface for their own feature-owned threads. */
export type FeatureConversationView = Extract<MainView, 'automation'>;

export function isFeatureConversationView(view: MainView): view is FeatureConversationView {
  return view === 'automation';
}

/** Routes that render the conversation surface together with its workspace panels. */
export function isConversationView(view: MainView): boolean {
  return view === 'chat' || isFeatureConversationView(view);
}
