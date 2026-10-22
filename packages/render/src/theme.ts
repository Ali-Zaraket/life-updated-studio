/** Bump when any template layout, colour or motion changes: it is recorded in every render manifest. */
export const TEMPLATE_VERSION = 1;

export const TEMPLATE_NAMES = ['EverydayMystery', 'TheUpdate', 'DecisionTest'] as const;
export type TemplateName = (typeof TEMPLATE_NAMES)[number];

/** Colour settings (SDR, sRGB values tagged Rec.709 on output). */
export const COLORS = {
  background: '#0B1020',
  backgroundDeep: '#070A15',
  panel: '#151C33',
  panelLine: '#2A3558',
  text: '#F4F6FB',
  textMuted: '#A9B3CF',
  accent: '#6EE7B7',
  accentWarm: '#FBBF24',
  caption: '#FFFFFF',
  captionBackdrop: 'rgba(5, 8, 18, 0.82)',
} as const;

export const COLOR_SETTINGS = {
  colorSpace: 'bt709',
  dynamicRange: 'SDR',
  palette: COLORS,
} as const;

export const FONT = {
  family: 'Inter',
  license: 'OFL-1.1',
  /** Weights bundled from @fontsource/inter (latin subset). */
  weights: [400, 600, 700] as const,
} as const;

/** Caption style. maxCharsPerLine must match what fits the safe width at this font size. */
export const CAPTION_STYLE = {
  fontSize: 80,
  lineHeight: 1.22,
  maxCharsPerLine: 32,
  maxLines: 2,
} as const;
