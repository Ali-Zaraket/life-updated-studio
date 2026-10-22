import React from 'react';
import { AbsoluteFill } from 'remotion';
import { COLORS } from '../theme';
import { SAFE_ZONES, safeRect } from '../safe-zones';
import { Background, BigText, Pill, Wordmark, baseText, useInterFont } from './shared';
import type { EpisodeProps } from '../props';

export const COVER_SAFE = safeRect(SAFE_ZONES.cover);

/** Cover still: wordmark, episode code and title, all inside the cover safe zone. */
export const CoverComposition: React.FC<EpisodeProps> = ({ episodeCode, title, mock }) => {
  useInterFont();
  return (
    <AbsoluteFill>
      <Background />
      <div style={{ position: 'absolute', left: COVER_SAFE.x, top: COVER_SAFE.y, width: COVER_SAFE.width, height: COVER_SAFE.height, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div>
          <Wordmark size={92} />
          <div style={{ height: 8, background: COLORS.accent, width: 220, marginTop: 44, borderRadius: 4 }} />
        </div>
        <div>
          <div style={{ ...baseText, fontSize: 64, fontWeight: 600, color: COLORS.accent, letterSpacing: 10, marginBottom: 56 }}>{episodeCode}</div>
          <BigText size={150}>{title}</BigText>
        </div>
        <div>{mock ? <Pill color={COLORS.accentWarm} size={44}>Mock - not for publication</Pill> : null}</div>
      </div>
    </AbsoluteFill>
  );
};
