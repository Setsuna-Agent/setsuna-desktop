import {
  Bot, BotMessageSquare, BrainCircuit, Cat, CodeXml, Ghost, GraduationCap, Headset,
  HeartHandshake, Lightbulb, Orbit, ShieldCheck, Smile, Sparkles, Telescope, UserRound,
} from 'lucide-react';
import { ICON_PALETTE } from '../../shared/ui/icon-colors.js';
import type { IconAvatarPreset } from '../../shared/ui/icon-avatars/presets.js';

/** Assistant identities use their own catalog, separate from app and plugin glyphs. */
export const ASSISTANT_AVATAR_PRESETS = [
  { key: 'bot', Icon: Bot, color: ICON_PALETTE.blue },
  { key: 'bot-chat', Icon: BotMessageSquare, color: ICON_PALETTE.green },
  { key: 'person', Icon: UserRound, color: ICON_PALETTE.blue },
  { key: 'headset', Icon: Headset, color: ICON_PALETTE.purple },
  { key: 'brain', Icon: BrainCircuit, color: ICON_PALETTE.purple },
  { key: 'sparkles', Icon: Sparkles, color: ICON_PALETTE.yellow },
  { key: 'idea', Icon: Lightbulb, color: ICON_PALETTE.orange },
  { key: 'companion', Icon: HeartHandshake, color: ICON_PALETTE.pink },
  { key: 'guardian', Icon: ShieldCheck, color: ICON_PALETTE.green },
  { key: 'researcher', Icon: Telescope, color: ICON_PALETTE.blue },
  { key: 'coder', Icon: CodeXml, color: ICON_PALETTE.purple },
  { key: 'tutor', Icon: GraduationCap, color: ICON_PALETTE.orange },
  { key: 'cat', Icon: Cat, color: ICON_PALETTE.yellow },
  { key: 'ghost', Icon: Ghost, color: ICON_PALETTE.purple },
  { key: 'smile', Icon: Smile, color: ICON_PALETTE.green },
  { key: 'orbit', Icon: Orbit, color: ICON_PALETTE.pink },
] as const satisfies readonly IconAvatarPreset[];

export const DEFAULT_ASSISTANT_AVATAR = { type: 'preset', key: ASSISTANT_AVATAR_PRESETS[0].key } as const;
