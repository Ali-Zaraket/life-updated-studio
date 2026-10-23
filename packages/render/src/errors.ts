export type RenderStage =
  | 'input'
  | 'captions'
  | 'bundle'
  | 'master'
  | 'mux'
  | 'loudness'
  | 'delivery'
  | 'cover'
  | 'subtitles'
  | 'validate'
  | 'manifest';

export class RenderError extends Error {
  readonly stage: RenderStage;
  constructor(stage: RenderStage, message: string, options?: { cause?: unknown }) {
    super(`render failed at stage "${stage}": ${message}`, options);
    this.name = 'RenderError';
    this.stage = stage;
  }
}
