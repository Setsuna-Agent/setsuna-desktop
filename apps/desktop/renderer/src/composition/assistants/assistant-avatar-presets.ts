import {
  Bot, BotMessageSquare, BrainCircuit, Cat, CodeXml, Ghost, GraduationCap, Headset,
  HeartHandshake, Lightbulb, Orbit, ShieldCheck, Smile, Sparkles, Telescope, UserRound,
} from 'lucide-react';
import type { IconAvatarPreset } from '../../shared/ui/icon-avatars/presets.js';

/** Assistant identities use their own catalog, separate from app and plugin glyphs. */
export const ASSISTANT_AVATAR_PRESETS = [
  { key: 'bot', Icon: Bot },
  { key: 'bot-chat', Icon: BotMessageSquare },
  { key: 'person', Icon: UserRound },
  { key: 'headset', Icon: Headset },
  { key: 'brain', Icon: BrainCircuit },
  { key: 'sparkles', Icon: Sparkles },
  { key: 'idea', Icon: Lightbulb },
  { key: 'companion', Icon: HeartHandshake },
  { key: 'guardian', Icon: ShieldCheck },
  { key: 'researcher', Icon: Telescope },
  { key: 'coder', Icon: CodeXml },
  { key: 'tutor', Icon: GraduationCap },
  { key: 'cat', Icon: Cat },
  { key: 'ghost', Icon: Ghost },
  { key: 'smile', Icon: Smile },
  { key: 'orbit', Icon: Orbit },
] as const satisfies readonly IconAvatarPreset[];

export const DEFAULT_ASSISTANT_AVATAR = { type: 'preset', key: ASSISTANT_AVATAR_PRESETS[0].key } as const;
