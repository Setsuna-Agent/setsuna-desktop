export type BrowserPageSleepBlocker = 'busy' | 'media' | 'unsaved' | 'unavailable';

export type BrowserPageSleepState = Readonly<{
  tabId: string;
  suspended: boolean;
}>;

export type BrowserPageSleepResult = Readonly<{
  suspended: boolean;
  blocker?: BrowserPageSleepBlocker;
}>;
