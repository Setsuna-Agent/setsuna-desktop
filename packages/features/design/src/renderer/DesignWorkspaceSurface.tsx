import { lazy, Suspense } from 'react';
import type { DesignWorkspaceProps } from './DesignWorkspace.js';

const LazyDesignWorkspace = lazy(() => import('./DesignWorkspace.js'));

export function DesignWorkspaceSurface(props: DesignWorkspaceProps) {
  return <Suspense fallback={null}><LazyDesignWorkspace {...props} /></Suspense>;
}
