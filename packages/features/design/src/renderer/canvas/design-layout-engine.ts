import type { Yoga } from 'yoga-layout/load';

let engine: Promise<Yoga> | undefined;

export function loadDesignLayoutEngine(): Promise<Yoga> {
  engine ??= import('yoga-layout/load').then(({ loadYoga }) => loadYoga()).catch((error: unknown) => {
    engine = undefined;
    throw error;
  });
  return engine;
}
