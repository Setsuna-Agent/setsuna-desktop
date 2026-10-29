import { normalizeBrandIconConfig } from '@setsuna-desktop/contracts';
import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';

export const COLLABORATION_AVATAR_KEYS = [
  'sun', 'flower', 'circle', 'sparkles', 'clover', 'atom', 'orbit', 'snowflake',
  'shell', 'gem', 'shapes', 'rainbow', 'moon', 'leaf', 'heart', 'waves',
] as const;
export type CollaborationAvatarKey = typeof COLLABORATION_AVATAR_KEYS[number];
export type CollaborationAgentAvatar = Readonly<
  | { type: 'preset'; key: CollaborationAvatarKey; color?: string }
  | { type: 'custom'; dataUrl: string }
>;

/** Share image limits with app/model icons; presets and colors belong to collaboration. */
export const collaborationAgentAvatarCodec = defineRuntimeCodec<CollaborationAgentAvatar>((value) => {
  const icon = normalizeBrandIconConfig(value);
  if (!icon) throw new Error('Invalid subagent avatar.');
  if (icon.type === 'custom') return Object.freeze(icon);
  const key = COLLABORATION_AVATAR_KEYS.find((key) => key === icon.key);
  if (!key) throw new Error('Unknown subagent avatar preset.');
  const color = (value as Record<string, unknown>).color;
  if (color !== undefined && (typeof color !== 'string' || (color !== 'text' && !/^#[a-f\d]{6}$/iu.test(color)))) {
    throw new Error('Invalid subagent avatar color.');
  }
  return Object.freeze({ type: 'preset', key, ...(color !== undefined ? { color: color as string } : {}) });
});
