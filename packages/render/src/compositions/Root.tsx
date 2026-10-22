import React from 'react';
import { Composition } from 'remotion';
import { DEFAULT_PROPS, type EpisodeProps } from '../props';
import { FRAME } from '../safe-zones';
import { TEMPLATE_NAMES } from '../theme';
import { EpisodeComposition } from './templates';
import { CoverComposition } from './Cover';

export const COVER_COMPOSITION_ID = 'EpisodeCover';

const calculateMetadata = ({ props }: { props: EpisodeProps }) => ({
  durationInFrames: Math.max(1, Math.round(props.durationSec * FRAME.fps)),
});

export const RemotionRoot: React.FC = () => (
  <>
    {TEMPLATE_NAMES.map((name) => (
      <Composition
        key={name}
        id={name}
        component={EpisodeComposition}
        width={FRAME.width}
        height={FRAME.height}
        fps={FRAME.fps}
        durationInFrames={FRAME.fps * 3}
        defaultProps={{ ...DEFAULT_PROPS, template: name }}
        calculateMetadata={calculateMetadata}
      />
    ))}
    <Composition
      id={COVER_COMPOSITION_ID}
      component={CoverComposition}
      width={FRAME.width}
      height={FRAME.height}
      fps={FRAME.fps}
      durationInFrames={1}
      defaultProps={DEFAULT_PROPS}
    />
  </>
);
