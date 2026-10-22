import type { CaptionCue } from './captions';
import type { TemplateName } from './theme';

export interface CompositionBeat {
  startSec: number;
  endSec: number;
  role: 'hook' | 'problem' | 'mechanism' | 'takeaway' | 'twist';
  narration: string;
  visual: string;
}

/** Serializable input props for every composition (Remotion requires plain JSON). */
export type EpisodeProps = {
  template: TemplateName;
  episodeCode: string;
  title: string;
  mock: boolean;
  /** Total video length in seconds (narration plus end hold). */
  durationSec: number;
  beats: CompositionBeat[];
  cues: CaptionCue[];
};

export const DEFAULT_PROPS: EpisodeProps = {
  template: 'EverydayMystery',
  episodeCode: 'LU-XXX-000',
  title: 'Preview title',
  mock: true,
  durationSec: 3,
  beats: [
    { startSec: 0, endSec: 3, role: 'hook', narration: 'A preview question appears here. Does it fit?', visual: 'Preview', },
  ],
  cues: [{ index: 1, startSec: 0, endSec: 3, lines: ['A preview question appears here.'], beatIndex: 0 }],
};
