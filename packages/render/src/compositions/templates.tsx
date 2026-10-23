import React from 'react';
import { AbsoluteFill, Sequence, useVideoConfig } from 'remotion';
import { COLORS, type TemplateName } from '../theme';
import type { CompositionBeat, EpisodeProps } from '../props';
import { Background, BigText, Captions, Card, Header, IllustrationTag, Kicker, Pill, Reveal, STAGE, baseText, useInterFont } from './shared';
import { HookCard, MechanismDiagram, ProblemCard, TakeawayCard, TwistCard } from './visuals';
import { firstSentence } from '../beat-text';

const SEG_GAP = 40;

/** Beat visual for The everyday mystery. */
const MysteryBeat: React.FC<{ beat: CompositionBeat }> = ({ beat }) => {
  switch (beat.role) {
    case 'hook':
      return <HookCard beat={beat} />;
    case 'problem':
      return <ProblemCard beat={beat} />;
    case 'mechanism':
      return <MechanismDiagram beat={beat} />;
    case 'takeaway':
      return <TakeawayCard beat={beat} />;
    case 'twist':
      return <TwistCard beat={beat} />;
  }
};

const UPDATE_STOPS = ['Before', 'What changed', 'What to do'] as const;
const stopIndex = (role: CompositionBeat['role']): number => (role === 'hook' || role === 'problem' ? 0 : role === 'mechanism' ? 1 : 2);

/** The update: a before / what changed / what to do strip over the same beat cards, with a before/after pair on the mechanism beat. */
const UpdateBeat: React.FC<{ beat: CompositionBeat; beats: CompositionBeat[] }> = ({ beat, beats }) => {
  const active = stopIndex(beat.role);
  const strip = (
    <div style={{ position: 'absolute', left: 0, top: 0, width: STAGE.width, display: 'flex', gap: SEG_GAP }}>
      {UPDATE_STOPS.map((s, i) => (
        <div
          key={s}
          style={{
            flex: 1,
            borderTop: `14px solid ${i === active ? COLORS.accentWarm : COLORS.panelLine}`,
            paddingTop: 24,
            ...baseText,
            fontSize: 46,
            fontWeight: i === active ? 700 : 400,
            color: i === active ? COLORS.accentWarm : COLORS.textMuted,
            textTransform: 'uppercase',
            letterSpacing: 5,
          }}
        >
          {s}
        </div>
      ))}
    </div>
  );
  const problem = beats.find((b) => b.role === 'problem') ?? beats[0]!;
  let body: React.ReactNode;
  if (beat.role === 'mechanism') {
    body = (
      <div style={{ position: 'absolute', left: 0, top: 0, width: STAGE.width }}>
        <Reveal>
          <Card accent={COLORS.panelLine} style={{ padding: 60 }}>
            <Kicker color={COLORS.textMuted}>Before</Kicker>
            <BigText size={76} weight={600} color={COLORS.textMuted}>
              {firstSentence(problem.narration)}
            </BigText>
          </Card>
        </Reveal>
        <Reveal delay={14} style={{ marginTop: 50 }}>
          <Card accent={COLORS.accentWarm} style={{ padding: 60 }}>
            <Kicker color={COLORS.accentWarm}>After</Kicker>
            <BigText size={76} weight={600}>
              {firstSentence(beat.narration)}
            </BigText>
          </Card>
        </Reveal>
      </div>
    );
  } else if (beat.role === 'takeaway') {
    body = <TakeawayCard beat={beat} accent={COLORS.accentWarm} kicker="What to do with the update" />;
  } else if (beat.role === 'hook') {
    body = <HookCard beat={beat} kicker="The update" />;
  } else if (beat.role === 'problem') {
    body = <ProblemCard beat={beat} kicker="Common understanding" />;
  } else {
    body = <TwistCard beat={beat} />;
  }
  return (
    <div style={{ position: 'relative', width: STAGE.width, height: STAGE.height - 40 }}>
      {strip}
      <div style={{ position: 'absolute', left: 0, top: 170, width: STAGE.width, height: STAGE.height - 40 - 170, overflow: 'hidden' }}>
        {/* Visual components size themselves to the full stage; scale them into the area below the strip. */}
        <div style={{ transform: 'scale(0.9)', transformOrigin: 'top left', width: STAGE.width / 0.9, height: STAGE.height / 0.9 }}>{body}</div>
      </div>
    </div>
  );
};

/** Decision test: two option panels with a divider; cards sit on top, the mechanism splits across the panels. */
const DecisionBeat: React.FC<{ beat: CompositionBeat }> = ({ beat }) => {
  const colW = (STAGE.width - 120) / 2;
  const mech = beat.role === 'mechanism';
  const labels = beat.onScreenText ?? [];
  const half = Math.ceil(labels.length / 2);
  const left = labels.slice(0, half);
  const right = labels.slice(half);
  const panel = (x: number, name: string, color: string) => (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: 0,
        width: colW,
        height: STAGE.height,
        borderRadius: 64,
        background: COLORS.panel,
        border: `5px solid ${mech ? color : COLORS.panelLine}`,
        opacity: mech ? 1 : 0.45,
        boxSizing: 'border-box',
      }}
    >
      <div style={{ ...baseText, padding: '50px 0 0 56px', fontSize: 50, fontWeight: 700, color, letterSpacing: 6, textTransform: 'uppercase' }}>{name}</div>
    </div>
  );
  return (
    <div style={{ position: 'relative', width: STAGE.width, height: STAGE.height }}>
      {panel(0, 'Option A', COLORS.accent)}
      {panel(colW + 120, 'Option B', COLORS.accentWarm)}
      <div style={{ position: 'absolute', left: colW - 20, top: STAGE.height / 2 - 100, width: 160, height: 160, borderRadius: 80, background: COLORS.backgroundDeep, border: `6px solid ${COLORS.panelLine}`, display: 'flex', alignItems: 'center', justifyContent: 'center', ...baseText, fontSize: 56, fontWeight: 700, color: COLORS.textMuted, zIndex: 3 }}>
        VS
      </div>
      {mech ? (
        <>
          <div style={{ position: 'absolute', left: 30, top: 130, width: colW - 60 }}>
            <MechanismDiagram beat={beat} labels={left.length ? left : ['-']} width={colW - 60} kicker=" " accent={COLORS.accent} />
          </div>
          <div style={{ position: 'absolute', left: colW + 150, top: 130, width: colW - 60 }}>
            <MechanismDiagram beat={beat} labels={right.length ? right : ['-']} width={colW - 60} kicker=" " accent={COLORS.accentWarm} />
          </div>
        </>
      ) : (
        <div style={{ position: 'absolute', left: 0, top: 240, width: STAGE.width, height: STAGE.height - 340, zIndex: 2 }}>
          <Reveal>
            <Card accent={COLORS.accent} style={{ background: COLORS.backgroundDeep, padding: 70 }}>
              <Kicker>{beat.role === 'hook' ? 'The decision' : beat.role === 'problem' ? 'The catch' : beat.role === 'takeaway' ? 'Decision rule' : 'Next question'}</Kicker>
              <BigText size={beat.role === 'hook' ? 110 : 92}>{beat.role === 'takeaway' ? firstSentence(beat.narration) : beat.role === 'hook' ? firstSentence(beat.narration) : firstSentence(beat.narration)}</BigText>
            </Card>
          </Reveal>
        </div>
      )}
    </div>
  );
};

const BeatLayer: React.FC<{ template: TemplateName; beat: CompositionBeat; beats: CompositionBeat[] }> = ({ template, beat, beats }) => {
  switch (template) {
    case 'EverydayMystery':
      return <MysteryBeat beat={beat} />;
    case 'TheUpdate':
      return <UpdateBeat beat={beat} beats={beats} />;
    case 'DecisionTest':
      return <DecisionBeat beat={beat} />;
  }
};

export const EpisodeComposition: React.FC<EpisodeProps> = (props) => {
  useInterFont();
  const { fps, durationInFrames } = useVideoConfig();
  const { beats } = props;
  return (
    <AbsoluteFill>
      <Background />
      <Header code={props.episodeCode} mock={props.mock} />
      {beats.map((b, i) => {
        const from = Math.round(b.startSec * fps);
        const end = i === beats.length - 1 ? durationInFrames : Math.round(b.endSec * fps);
        return (
          <Sequence key={i} from={from} durationInFrames={Math.max(1, end - from)} layout="none">
            <div style={{ position: 'absolute', left: STAGE.x, top: STAGE.y + 40, width: STAGE.width, height: STAGE.height - 40 }}>
              <BeatLayer template={props.template} beat={b} beats={beats} />
            </div>
          </Sequence>
        );
      })}
      <IllustrationTag />
      <Captions cues={props.cues} />
    </AbsoluteFill>
  );
};

export { Pill };
