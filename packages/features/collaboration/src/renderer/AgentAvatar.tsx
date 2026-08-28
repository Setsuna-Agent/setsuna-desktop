import {
  Atom,
  CircleDot,
  Clover,
  Flower2,
  Gem,
  Heart,
  Leaf,
  MoonStar,
  Orbit,
  Rainbow,
  Shapes,
  Shell,
  Snowflake,
  Sparkles,
  SunMedium,
  Waves,
  type LucideIcon,
} from 'lucide-react';
import { useId, useMemo } from 'react';
import type { CollaborationAgentIdentity } from '../contracts/index.js';
import './collaboration.css';

type AvatarIcon = Readonly<{
  gradient: readonly [start: string, end: string];
  Icon: LucideIcon;
}>;

// Adjacent, high-chroma colors stay lively without turning the avatar set into a rainbow mix.
const AVATAR_ICONS: readonly AvatarIcon[] = [
  { Icon: SunMedium, gradient: ['#ffe66d', '#ffad1f'] },
  { Icon: Flower2, gradient: ['#ff9fbc', '#ff4f7b'] },
  { Icon: CircleDot, gradient: ['#78f3d1', '#20c997'] },
  { Icon: Sparkles, gradient: ['#c4b5fd', '#8b5cf6'] },
  { Icon: Clover, gradient: ['#bef264', '#34d399'] },
  { Icon: Atom, gradient: ['#7dd3fc', '#3b82f6'] },
  { Icon: Orbit, gradient: ['#fda4af', '#f472b6'] },
  { Icon: Snowflake, gradient: ['#a5f3fc', '#22b8cf'] },
  { Icon: Shell, gradient: ['#fdba74', '#fb7185'] },
  { Icon: Gem, gradient: ['#d8b4fe', '#a855f7'] },
  { Icon: Shapes, gradient: ['#ffad8f', '#ff5d8f'] },
  { Icon: Rainbow, gradient: ['#fde68a', '#fb923c'] },
  { Icon: MoonStar, gradient: ['#a5b4fc', '#6366f1'] },
  { Icon: Leaf, gradient: ['#a7f3d0', '#10b981'] },
  { Icon: Heart, gradient: ['#f9a8d4', '#c084fc'] },
  { Icon: Waves, gradient: ['#5eead4', '#38bdf8'] },
];

/** Deterministically selects a bundled avatar from the persisted identity seed. */
export function AgentAvatar({
  identity,
  size = 28,
}: Readonly<{
  identity: CollaborationAgentIdentity;
  size?: number;
}>) {
  const gradientId = `subagent-avatar-${useId().replaceAll(':', '')}`;
  const avatar = useMemo(() => {
    let hash = 0;
    for (let index = 0; index < identity.avatarSeed.length; index += 1) {
      hash = (hash * 31 + identity.avatarSeed.charCodeAt(index)) >>> 0;
    }
    return AVATAR_ICONS[hash % AVATAR_ICONS.length] ?? AVATAR_ICONS[0]!;
  }, [identity.avatarSeed]);
  const AvatarIcon = avatar.Icon;

  return (
    <span
      className="subagent-avatar"
      aria-hidden="true"
      style={{ height: size, width: size }}
    >
      <AvatarIcon
        color={`url(#${gradientId})`}
        fill={`url(#${gradientId})`}
        fillOpacity={0.18}
        size={size}
        strokeWidth={2.1}
      >
        <defs>
          <linearGradient
            id={gradientId}
            x1="3"
            y1="2"
            x2="21"
            y2="22"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor={avatar.gradient[0]} />
            <stop offset="1" stopColor={avatar.gradient[1]} />
          </linearGradient>
        </defs>
      </AvatarIcon>
    </span>
  );
}
