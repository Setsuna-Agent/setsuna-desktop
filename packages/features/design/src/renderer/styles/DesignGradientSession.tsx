import { createContext, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import type { DesignGradient, DesignNode } from '../../contracts/index.js';
import type { DesignGradientTarget } from './design-gradient-geometry.js';

export type GradientDraft = Readonly<{ source: DesignGradient; value: DesignGradient; revision: string }>;
export type GradientSession = Readonly<{
  owner: string;
  target: DesignGradientTarget;
  selectedStop: number;
  draft?: GradientDraft;
}>;

export const DesignGradientSessionContext = createContext<Readonly<{
  session: GradientSession | undefined;
  setSession: Dispatch<SetStateAction<GradientSession | undefined>>;
}> | null>(null);

export function DesignGradientSessionProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [session, setSession] = useState<GradientSession>();
  const value = useMemo(() => ({ session, setSession }), [session]);
  return <DesignGradientSessionContext.Provider value={value}>{children}</DesignGradientSessionContext.Provider>;
}

export function designGradientFor(node: DesignNode, { stack, index }: DesignGradientTarget) {
  if (stack === 'strokes') return node.strokes?.[index]?.gradient;
  return node.kind === 'image' ? undefined : node.fills?.[index]?.gradient;
}

export function withDesignGradient(node: DesignNode, { stack, index }: DesignGradientTarget, gradient: DesignGradient): DesignNode {
  if (stack === 'fills') return node.kind === 'image' ? node
    : { ...node, fills: node.fills?.map((paint, at) => at === index ? { ...paint, gradient } : paint) };
  return { ...node, strokes: node.strokes?.map((paint, at) => at === index ? { ...paint, gradient } : paint) };
}

export function sortDesignGradientStops(gradient: DesignGradient, selectedStop: number) {
  const stops = [...gradient.stops].sort((a, b) => a.offset - b.offset);
  return { value: { ...gradient, stops }, selectedStop: stops.indexOf(gradient.stops[selectedStop]) };
}
