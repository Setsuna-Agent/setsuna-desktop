import type { RuntimeReviewFinding } from '@setsuna-desktop/contracts';

export type DesktopReviewSource = 'unstaged' | 'staged' | 'branch' | 'latest';

export type DesktopReviewFocusRequest = {
  finding?: RuntimeReviewFinding;
  line?: number;
  path: string;
  version: number;
};

export type DesktopReviewOpenHandler = (
  filePath?: string,
  line?: number,
  finding?: RuntimeReviewFinding,
) => void;
