import React, { useMemo } from 'react';
import { createAvatar } from '@dicebear/core';
import { adventurer } from '@dicebear/collection';

interface PlayerAvatarProps {
  username: string;
  size?: number;        // px — defaults to 36
  className?: string;
  ring?: boolean;       // show neon ring border
  ringColor?: string;   // tailwind color token e.g. 'neon-purple'
}

// Deterministic: same username always produces the same avatar
function buildAvatarSvg(username: string): string {
  const avatar = createAvatar(adventurer, {
    seed: username,
    backgroundColor: ['b6e3f4', 'c0aede', 'ffd5dc', 'ffdfbf', 'd1d4f9'],
    backgroundType: ['gradientLinear'],
    radius: 50,
  });
  return avatar.toString();
}

export const PlayerAvatar: React.FC<PlayerAvatarProps> = ({
  username,
  size = 36,
  className = '',
  ring = false,
  ringColor = 'neon-purple',
}) => {
  const svgString = useMemo(() => buildAvatarSvg(username), [username]);
  const dataUri = `data:image/svg+xml;utf8,${encodeURIComponent(svgString)}`;

  return (
    <div
      className={`shrink-0 rounded-full overflow-hidden ${ring ? `ring-2 ring-offset-1 ring-offset-navy-darker ring-${ringColor}` : ''} ${className}`}
      style={{ width: size, height: size }}
    >
      <img
        src={dataUri}
        alt={`${username}'s avatar`}
        width={size}
        height={size}
        style={{ width: size, height: size }}
        draggable={false}
      />
    </div>
  );
};

export default PlayerAvatar;
