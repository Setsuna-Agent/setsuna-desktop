import { useMemo } from 'react';
import type { CollaborationAgentIdentity } from '../contracts/index.js';
import appleAvatarUrl from './avatars/apple.svg';
import avocadoAvatarUrl from './avatars/avocado.svg';
import bellPepperAvatarUrl from './avatars/bell-pepper.svg';
import blueberryAvatarUrl from './avatars/blueberry.svg';
import carrotAvatarUrl from './avatars/carrot.svg';
import cherryAvatarUrl from './avatars/cherry.svg';
import jujubeAvatarUrl from './avatars/jujube.svg';
import mangoAvatarUrl from './avatars/mango.svg';
import mushroomAvatarUrl from './avatars/mushroom.svg';
import orangeAvatarUrl from './avatars/orange.svg';
import peachAvatarUrl from './avatars/peach.svg';
import pearAvatarUrl from './avatars/pear.svg';
import plumAvatarUrl from './avatars/plum.svg';
import pumpkinAvatarUrl from './avatars/pumpkin.svg';
import strawberryAvatarUrl from './avatars/strawberry.svg';
import watermelonAvatarUrl from './avatars/watermelon.svg';
import './collaboration.css';

const AVATAR_ICON_URLS = [
  watermelonAvatarUrl,
  peachAvatarUrl,
  orangeAvatarUrl,
  strawberryAvatarUrl,
  appleAvatarUrl,
  blueberryAvatarUrl,
  plumAvatarUrl,
  mangoAvatarUrl,
  pearAvatarUrl,
  cherryAvatarUrl,
  avocadoAvatarUrl,
  carrotAvatarUrl,
  pumpkinAvatarUrl,
  mushroomAvatarUrl,
  bellPepperAvatarUrl,
  jujubeAvatarUrl,
];

/** Deterministically selects a bundled avatar from the persisted identity seed. */
export function AgentAvatar({
  identity,
  size = 28,
}: Readonly<{
  identity: CollaborationAgentIdentity;
  size?: number;
}>) {
  const avatarUrl = useMemo(() => {
    let hash = 0;
    for (let index = 0; index < identity.avatarSeed.length; index += 1) {
      hash = (hash * 31 + identity.avatarSeed.charCodeAt(index)) >>> 0;
    }
    return AVATAR_ICON_URLS[hash % AVATAR_ICON_URLS.length] ?? appleAvatarUrl;
  }, [identity.avatarSeed]);
  return (
    <span
      className="subagent-avatar"
      aria-hidden="true"
      style={{ height: size, width: size }}
    >
      <img src={avatarUrl} alt="" draggable={false} />
    </span>
  );
}
