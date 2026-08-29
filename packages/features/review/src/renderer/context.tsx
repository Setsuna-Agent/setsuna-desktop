import { createContext, useContext, type ReactNode } from 'react';
import {
  createNoopReviewRendererService,
  type ReviewRendererService,
} from '../contracts/index.js';

const ReviewRendererContext = createContext<ReviewRendererService>(
  createNoopReviewRendererService(),
);

export function ReviewRendererProvider({
  children,
  service,
}: Readonly<{
  children: ReactNode;
  service: ReviewRendererService;
}>) {
  return (
    <ReviewRendererContext.Provider value={service}>
      {children}
    </ReviewRendererContext.Provider>
  );
}

export function useReviewRendererService(): ReviewRendererService {
  return useContext(ReviewRendererContext);
}
