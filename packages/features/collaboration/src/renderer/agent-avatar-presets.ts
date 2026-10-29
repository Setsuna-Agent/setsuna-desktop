import {
  Atom, CircleDot, Clover, Flower2, Gem, Heart, Leaf, MoonStar, Orbit, Rainbow,
  Shapes, Shell, Snowflake, Sparkles, SunMedium, Waves, type LucideIcon,
} from 'lucide-react';
import { COLLABORATION_AVATAR_KEYS, type CollaborationAvatarKey } from '../contracts/index.js';

type AvatarPreset = Readonly<{ Icon: LucideIcon; gradient: readonly [string, string] }>;

// Preserve the original key order so existing generated task identities keep their avatars.
export const AGENT_AVATAR_PRESETS = {
  sun: { Icon: SunMedium, gradient: ['#ffe66d', '#ffad1f'] },
  flower: { Icon: Flower2, gradient: ['#ff9fbc', '#ff4f7b'] },
  circle: { Icon: CircleDot, gradient: ['#78f3d1', '#20c997'] },
  sparkles: { Icon: Sparkles, gradient: ['#c4b5fd', '#8b5cf6'] },
  clover: { Icon: Clover, gradient: ['#bef264', '#34d399'] },
  atom: { Icon: Atom, gradient: ['#7dd3fc', '#3b82f6'] },
  orbit: { Icon: Orbit, gradient: ['#fda4af', '#f472b6'] },
  snowflake: { Icon: Snowflake, gradient: ['#a5f3fc', '#22b8cf'] },
  shell: { Icon: Shell, gradient: ['#fdba74', '#fb7185'] },
  gem: { Icon: Gem, gradient: ['#d8b4fe', '#a855f7'] },
  shapes: { Icon: Shapes, gradient: ['#ffad8f', '#ff5d8f'] },
  rainbow: { Icon: Rainbow, gradient: ['#fde68a', '#fb923c'] },
  moon: { Icon: MoonStar, gradient: ['#a5b4fc', '#6366f1'] },
  leaf: { Icon: Leaf, gradient: ['#a7f3d0', '#10b981'] },
  heart: { Icon: Heart, gradient: ['#f9a8d4', '#c084fc'] },
  waves: { Icon: Waves, gradient: ['#5eead4', '#38bdf8'] },
} as const satisfies Record<CollaborationAvatarKey, AvatarPreset>;

export function agentAvatarKey(seed: string): CollaborationAvatarKey {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  return COLLABORATION_AVATAR_KEYS[hash % COLLABORATION_AVATAR_KEYS.length]!;
}
