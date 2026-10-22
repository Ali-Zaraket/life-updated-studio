import React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { COLORS } from '../theme';
import { BigText, Card, Kicker, Reveal, STAGE, baseText } from './shared';
import { checklistItems, firstSentence, questionOf, stripTag } from '../beat-text';
import type { CompositionBeat } from '../props';

const W = STAGE.width;
const H = STAGE.height;

const Ring: React.FC<{ size: number; color: string; style?: React.CSSProperties; stroke?: number }> = ({ size, color, style, stroke = 14 }) => (
  <div style={{ width: size, height: size, borderRadius: size, border: `${stroke}px solid ${color}`, boxSizing: 'border-box', ...style }} />
);

/** Hook question card. */
export const HookCard: React.FC<{ beat: CompositionBeat; kicker?: string }> = ({ beat, kicker = 'The question' }) => (
  <div style={{ position: 'relative', width: W, height: H }}>
    <Ring size={1100} color={COLORS.panelLine} style={{ position: 'absolute', right: -420, top: 500 }} stroke={22} />
    <Ring size={620} color={COLORS.accent} style={{ position: 'absolute', right: -200, top: 760, opacity: 0.5 }} />
    <Reveal style={{ position: 'absolute', left: 0, top: 160, width: W - 120 }}>
      <Kicker>{kicker}</Kicker>
      <BigText size={140}>{questionOf(beat.narration)}</BigText>
    </Reveal>
  </div>
);

/** Problem framing card with an abstract prompt shape. */
export const ProblemCard: React.FC<{ beat: CompositionBeat; kicker?: string }> = ({ beat, kicker = 'The problem' }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pulse = interpolate(Math.sin((frame / fps) * 3), [-1, 1], [0.55, 1]);
  return (
    <div style={{ position: 'relative', width: W, height: H }}>
      <Reveal style={{ position: 'absolute', left: 0, top: 40, width: W }}>
        <Kicker>{kicker}</Kicker>
        <BigText size={112}>{firstSentence(beat.narration)}</BigText>
      </Reveal>
      <Reveal delay={8} style={{ position: 'absolute', left: 0, top: H - 760, width: W }}>
        <Card style={{ padding: 70 }}>
          <div style={{ height: 40, width: 560, background: COLORS.panelLine, borderRadius: 20 }} />
          <div style={{ height: 40, width: 900, background: COLORS.panelLine, borderRadius: 20, marginTop: 36 }} />
          <div style={{ display: 'flex', gap: 48, marginTop: 70 }}>
            <div style={{ flex: 1, height: 130, borderRadius: 65, border: `6px solid ${COLORS.panelLine}` }} />
            <div style={{ flex: 1, height: 130, borderRadius: 65, background: COLORS.accent, opacity: pulse }} />
          </div>
        </Card>
      </Reveal>
    </div>
  );
};

/** Mechanism diagram: labelled nodes from the beat's visual text, highlighted in sequence. */
export const MechanismDiagram: React.FC<{
  beat: CompositionBeat;
  labels?: string[];
  width?: number;
  kicker?: string;
  accent?: string;
}> = ({ beat, labels, width = W, kicker = 'How it works', accent = COLORS.accent }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  // Only reviewed on-screen text becomes labels; the visual note is direction, never screen copy.
  const nodes = labels ?? beat.onScreenText ?? [firstSentence(beat.narration)];
  const n = Math.max(nodes.length, 1);
  const gap = 110;
  const top = 190;
  const avail = H - top - 120;
  const nodeH = Math.min(300, (avail - gap * (n - 1)) / n);
  const active = Math.min(n - 1, Math.floor((frame / Math.max(durationInFrames, 1)) * n));
  const fontSize = width < W ? 70 : 92;
  return (
    <div style={{ position: 'relative', width, height: H }}>
      <Reveal style={{ position: 'absolute', left: 0, top: 0 }}>
        <Kicker color={accent}>{kicker}</Kicker>
      </Reveal>
      {nodes.map((label, i) => {
        const y = top + i * (nodeH + gap);
        const inP = spring({ frame: frame - 6 - i * 10, fps, config: { damping: 200 }, durationInFrames: 20 });
        const on = i === active;
        return (
          <React.Fragment key={i}>
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: y,
                width,
                height: nodeH,
                boxSizing: 'border-box',
                borderRadius: 56,
                background: on ? accent : COLORS.panel,
                border: `5px solid ${on ? accent : COLORS.panelLine}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: inP,
                transform: `scale(${0.94 + 0.06 * inP})`,
                padding: '0 50px',
              }}
            >
              <div style={{ ...baseText, fontSize, fontWeight: 700, textAlign: 'center', lineHeight: 1.1, color: on ? COLORS.backgroundDeep : COLORS.text }}>
                {label.charAt(0).toUpperCase() + label.slice(1)}
              </div>
            </div>
            {i < n - 1 ? (
              <div style={{ position: 'absolute', left: width / 2 - 8, top: y + nodeH + 14, width: 16, height: gap - 28, background: COLORS.panelLine, opacity: inP, borderRadius: 8 }}>
                <div
                  style={{
                    position: 'absolute',
                    left: -24,
                    bottom: -18,
                    width: 0,
                    height: 0,
                    borderLeft: '32px solid transparent',
                    borderRight: '32px solid transparent',
                    borderTop: `36px solid ${COLORS.panelLine}`,
                  }}
                />
              </div>
            ) : null}
          </React.Fragment>
        );
      })}
    </div>
  );
};

/** Takeaway checklist card. */
export const TakeawayCard: React.FC<{ beat: CompositionBeat; kicker?: string; accent?: string }> = ({ beat, kicker = 'What to do', accent = COLORS.accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const items = beat.onScreenText ?? checklistItems(beat.narration);
  return (
    <div style={{ position: 'relative', width: W, height: H }}>
      <Reveal style={{ position: 'absolute', left: 0, top: 40 }}>
        <Kicker color={accent}>{kicker}</Kicker>
      </Reveal>
      {items.map((it, i) => {
        const p = spring({ frame: frame - 10 - i * 14, fps, config: { damping: 200 }, durationInFrames: 20 });
        return (
          <div key={i} style={{ position: 'absolute', left: 0, top: 200 + i * 400, width: W, opacity: p, transform: `translateX(${(1 - p) * 80}px)` }}>
            <Card style={{ padding: 60, display: 'flex', alignItems: 'center', gap: 56 }} accent={accent}>
              <div style={{ width: 130, height: 130, borderRadius: 65, background: accent, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ width: 38, height: 70, borderRight: `18px solid ${COLORS.backgroundDeep}`, borderBottom: `18px solid ${COLORS.backgroundDeep}`, transform: 'rotate(40deg) translate(-4px,-8px)' }} />
              </div>
              <BigText size={84} weight={600}>
                {it}
              </BigText>
            </Card>
          </div>
        );
      })}
    </div>
  );
};

/** Twist question card. */
export const TwistCard: React.FC<{ beat: CompositionBeat; kicker?: string }> = ({ beat, kicker }) => {
  const isQuestion = questionOf(beat.narration).trim().endsWith('?');
  const label = kicker ?? (isQuestion ? 'Next question' : 'One more thing');
  const frame = useCurrentFrame();
  const drift = interpolate(Math.sin(frame / 20), [-1, 1], [-14, 14]);
  return (
    <div style={{ position: 'relative', width: W, height: H }}>
      <Ring size={900} color={COLORS.panelLine} style={{ position: 'absolute', right: -200, bottom: 20 + drift }} stroke={22} />
      {isQuestion && (
        <div style={{ ...baseText, position: 'absolute', right: 160, bottom: 180 + drift, fontSize: 700, fontWeight: 700, color: COLORS.accent, opacity: 0.85, lineHeight: 1 }}>?</div>
      )}
      <Reveal style={{ position: 'absolute', left: 0, top: 80, width: W - 80 }}>
        <Kicker>{label}</Kicker>
        <BigText size={112}>{questionOf(beat.narration)}</BigText>
      </Reveal>
    </div>
  );
};

export const visualDescription = (b: CompositionBeat): string => stripTag(b.visual);
