import React, { useEffect, useState } from 'react';
import { AbsoluteFill, Sequence, cancelRender, continueRender, delayRender, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { CAPTION_STYLE, COLORS, FONT } from '../theme';
import { SAFE_ZONES, safeRect, FRAME, type Rect } from '../safe-zones';
import type { CaptionCue } from '../captions';

export const SAFE = safeRect(SAFE_ZONES.video);
export const HEADER_H = 240;
const CAPTION_BOX_H = Math.ceil(CAPTION_STYLE.fontSize * CAPTION_STYLE.lineHeight * CAPTION_STYLE.maxLines) + 70;
/** Region between header and captions where beat visuals live. */
export const STAGE: Rect = {
  x: SAFE.x,
  y: SAFE.y + HEADER_H,
  width: SAFE.width,
  height: SAFE.y + SAFE.height - CAPTION_BOX_H - 60 - (SAFE.y + HEADER_H),
};
export const CAPTION_BOX: Rect = {
  x: SAFE.x,
  y: SAFE.y + SAFE.height - CAPTION_BOX_H,
  width: SAFE.width,
  height: CAPTION_BOX_H,
};

export const FONT_FILES: Record<number, string> = {
  400: 'fonts/inter-latin-400-normal.woff2',
  600: 'fonts/inter-latin-600-normal.woff2',
  700: 'fonts/inter-latin-700-normal.woff2',
};

/** Loads the bundled Inter files (served from the bundle's public dir, never the network). */
export function useInterFont(): void {
  const [handle] = useState(() => delayRender('Loading Inter'));
  useEffect(() => {
    Promise.all(
      FONT.weights.map(async (w) => {
        const face = new FontFace(FONT.family, `url(${staticFile(FONT_FILES[w]!)})`, { weight: String(w) });
        await face.load();
        (document.fonts as unknown as { add(f: FontFace): void }).add(face);
      }),
    )
      .then(() => continueRender(handle))
      .catch((e) => cancelRender(e));
  }, [handle]);
}

export const baseText: React.CSSProperties = {
  fontFamily: `${FONT.family}, sans-serif`,
  color: COLORS.text,
  margin: 0,
};

export const Background: React.FC = () => (
  <AbsoluteFill
    style={{
      background: `radial-gradient(1800px 1400px at 85% 8%, rgba(110,231,183,0.10), rgba(0,0,0,0) 70%), linear-gradient(180deg, ${COLORS.background}, ${COLORS.backgroundDeep})`,
    }}
  />
);

export const Wordmark: React.FC<{ size?: number }> = ({ size = 76 }) => (
  <div style={{ ...baseText, fontWeight: 700, fontSize: size, letterSpacing: size * 0.04, lineHeight: 1 }}>
    LIFE<span style={{ color: COLORS.accent }}>:</span> UPDATED<span style={{ color: COLORS.accent }}>.</span>
  </div>
);

export const Pill: React.FC<{ children: React.ReactNode; color?: string; size?: number }> = ({ children, color = COLORS.accent, size = 44 }) => (
  <div
    style={{
      ...baseText,
      display: 'inline-block',
      fontSize: size,
      fontWeight: 600,
      color,
      border: `4px solid ${color}`,
      borderRadius: size,
      padding: `${size * 0.22}px ${size * 0.6}px`,
      letterSpacing: size * 0.06,
      textTransform: 'uppercase',
    }}
  >
    {children}
  </div>
);

export const Header: React.FC<{ code: string; mock: boolean }> = ({ code, mock }) => (
  <div style={{ position: 'absolute', left: SAFE.x, top: SAFE.y, width: SAFE.width, height: HEADER_H }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <Wordmark />
      <div style={{ ...baseText, fontSize: 56, fontWeight: 600, color: COLORS.textMuted, letterSpacing: 3 }}>{code}</div>
    </div>
    <div style={{ height: 6, background: COLORS.panelLine, marginTop: 36, borderRadius: 3 }} />
    {mock ? (
      <div style={{ marginTop: 30 }}>
        <Pill color={COLORS.accentWarm} size={36}>
          Mock narration - not for publication
        </Pill>
      </div>
    ) : null}
  </div>
);

/** Fade/slide in at the start of the enclosing Sequence and fade out at its end. */
export const Reveal: React.FC<{ children: React.ReactNode; delay?: number; fadeOut?: boolean; style?: React.CSSProperties }> = ({
  children,
  delay = 0,
  fadeOut = true,
  style,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames, fps } = useVideoConfig();
  const p = spring({ frame: frame - delay, fps, config: { damping: 200 }, durationInFrames: 18 });
  const out = fadeOut ? interpolate(frame, [durationInFrames - 8, durationInFrames], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) : 1;
  return <div style={{ opacity: p * out, transform: `translateY(${(1 - p) * 60}px)`, ...style }}>{children}</div>;
};

export const Card: React.FC<{ children: React.ReactNode; style?: React.CSSProperties; accent?: string }> = ({ children, style, accent }) => (
  <div
    style={{
      background: COLORS.panel,
      border: `5px solid ${accent ?? COLORS.panelLine}`,
      borderRadius: 64,
      padding: 80,
      boxSizing: 'border-box',
      ...style,
    }}
  >
    {children}
  </div>
);

export const Kicker: React.FC<{ children: React.ReactNode; color?: string }> = ({ children, color = COLORS.accent }) => (
  <div style={{ ...baseText, color, fontSize: 52, fontWeight: 600, letterSpacing: 8, textTransform: 'uppercase', marginBottom: 48 }}>{children}</div>
);

export const IllustrationTag: React.FC = () => (
  <div style={{ position: 'absolute', right: FRAME.width - (SAFE.x + SAFE.width), top: SAFE.y + 150 }}>
    <Pill color={COLORS.textMuted} size={36}>
      Illustration
    </Pill>
  </div>
);

export const BigText: React.FC<{ children: React.ReactNode; size?: number; color?: string; weight?: 400 | 600 | 700 }> = ({
  children,
  size = 128,
  color = COLORS.text,
  weight = 700,
}) => <div style={{ ...baseText, fontSize: size, fontWeight: weight, lineHeight: 1.12, color, letterSpacing: -size * 0.01 }}>{children}</div>;

export const Captions: React.FC<{ cues: CaptionCue[] }> = ({ cues }) => {
  const { fps } = useVideoConfig();
  return (
    <>
      {cues.map((c) => {
        const from = Math.round(c.startSec * fps);
        const dur = Math.max(1, Math.round(c.endSec * fps) - from);
        return (
          <Sequence key={c.index} from={from} durationInFrames={dur} layout="none">
            <div
              style={{
                position: 'absolute',
                left: CAPTION_BOX.x,
                top: CAPTION_BOX.y,
                width: CAPTION_BOX.width,
                height: CAPTION_BOX.height,
                display: 'flex',
                alignItems: 'flex-end',
                justifyContent: 'center',
              }}
            >
              <div
                style={{
                  ...baseText,
                  background: COLORS.captionBackdrop,
                  color: COLORS.caption,
                  fontWeight: 600,
                  fontSize: CAPTION_STYLE.fontSize,
                  lineHeight: CAPTION_STYLE.lineHeight,
                  textAlign: 'center',
                  padding: '22px 44px',
                  borderRadius: 40,
                  maxWidth: CAPTION_BOX.width,
                  boxSizing: 'border-box',
                }}
              >
                {c.lines.map((l, i) => (
                  <div key={i} style={{ whiteSpace: 'nowrap' }}>
                    {l}
                  </div>
                ))}
              </div>
            </div>
          </Sequence>
        );
      })}
    </>
  );
};

export const frameSize = FRAME;
