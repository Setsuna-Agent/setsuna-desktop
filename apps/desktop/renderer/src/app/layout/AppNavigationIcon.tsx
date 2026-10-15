// Filled variants adapted from Lucide (ISC); see THIRD_PARTY_NOTICES.md.
import { Blocks, Clock3, GitPullRequest, Home, Settings } from 'lucide-react';
import type { ReactNode } from 'react';

const outlineIcons = {
  chat: Home,
  'pull-requests': GitPullRequest,
  automation: Clock3,
  capabilities: Blocks,
  settings: Settings,
};

export type AppNavigationIconName = keyof typeof outlineIcons;

// Explicit cutouts keep the clock hands, doorway and gear centre readable on
// any sidebar background; filling the outline SVG alone would cover them.
const filledIcons: Partial<Record<AppNavigationIconName, ReactNode>> = {
  chat: <path fillRule="evenodd" d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 21v-8a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v8z" />,
  automation: <path fillRule="evenodd" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z M11 6v7h5.5v-2H13V6z" />,
  settings: <path fillRule="evenodd" d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z M15 12a3 3 0 1 0-6 0 3 3 0 0 0 6 0z" />,
};

export function AppNavigationIcon({ name, active }: { name: AppNavigationIconName; active: boolean }) {
  const OutlineIcon = outlineIcons[name];
  const filledIcon = active ? filledIcons[name] : undefined;
  return filledIcon
    ? <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true" focusable="false">
      {filledIcon}
    </svg>
    : <OutlineIcon size={18} aria-hidden="true" focusable="false" />;
}
