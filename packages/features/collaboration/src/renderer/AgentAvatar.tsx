import { iconColorCssValue } from '@setsuna-desktop/renderer-ui';
import { useId } from 'react';
import type { CollaborationAgentIdentity } from '../contracts/index.js';
import { AGENT_AVATAR_PRESETS, agentAvatarKey } from './agent-avatar-presets.js';
import './collaboration.css';

/** Configured avatars are captured on identity; older tasks retain their seeded fallback. */
export function AgentAvatar({ identity, size = 28 }: Readonly<{
  identity: CollaborationAgentIdentity;
  size?: number;
}>) {
  const gradientId = `subagent-avatar-${useId().replaceAll(':', '')}`;
  const configured = identity.avatar;
  const preset = AGENT_AVATAR_PRESETS[configured?.type === 'preset' ? configured.key : agentAvatarKey(identity.avatarSeed)];
  const Icon = preset.Icon;
  const color = configured?.type === 'preset' && configured.color
    ? iconColorCssValue(configured.color) : `url(#${gradientId})`;
  return (
    <span className="subagent-avatar" aria-hidden="true" style={{ height: size, width: size }}>
      {configured?.type === 'custom' ? <img src={configured.dataUrl} alt="" draggable={false} /> : (
        <Icon color={color} fill={color} fillOpacity={0.18} size={size} strokeWidth={2.1}>
          <defs>
            <linearGradient id={gradientId} x1="3" y1="2" x2="21" y2="22" gradientUnits="userSpaceOnUse">
              <stop stopColor={preset.gradient[0]} /><stop offset="1" stopColor={preset.gradient[1]} />
            </linearGradient>
          </defs>
        </Icon>
      )}
    </span>
  );
}
