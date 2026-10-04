/** Passwords never cross the desktop renderer or runtime bridges. */
export type BrowserSavedLogin = Readonly<{ id: string; username: string }>;

export type BrowserPasswordPrompt = Readonly<{
  id: string;
  origin: string;
  username: string;
  update: boolean;
}>;

export type BrowserPasswordState = Readonly<{
  tabId: string;
  origin: string | null;
  available: boolean;
  logins: readonly BrowserSavedLogin[];
  prompt: BrowserPasswordPrompt | null;
}>;

export interface BrowserPasswordBridge {
  getPasswordState(tabId: string): Promise<BrowserPasswordState | null>;
  savePassword(tabId: string, promptId: string): Promise<boolean>;
  dismissPassword(tabId: string, promptId: string): Promise<void>;
  fillPassword(tabId: string, loginId: string): Promise<boolean>;
  deletePassword(tabId: string, loginId: string): Promise<boolean>;
  onPasswordState(callback: (state: BrowserPasswordState) => void): () => void;
}
