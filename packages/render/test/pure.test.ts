import { describe, expect, it } from 'vitest';
import { buildCaptionTimeline, checkCaptionLayout, scaleBeats, toSrt, toVtt, type CaptionCue } from '../src/captions';
import { FRAME, SAFE_ZONES, rectInside, safeRect, validateInsets } from '../src/safe-zones';
import { cuesSha256, inputsSha256, type ManifestInputs } from '../src/manifest';
import { checklistItems, diagramLabels, questionOf } from '../src/beat-text';
import { CAPTION_STYLE } from '../src/theme';
import { fixturePacket } from '../../content/src/index';

const beats = fixturePacket(new Date('2026-10-22T00:00:00Z')).version.beats;
const wc = (s: string) => s.split(/\s+/).filter(Boolean).length;

describe('buildCaptionTimeline', () => {
  const cues = buildCaptionTimeline(beats, { wordsPerMinute: 150 });

  it('keeps cues within limits, never splits words, and keeps all words in order', () => {
    expect(checkCaptionLayout(cues, { maxCharsPerLine: 32, maxLines: 2 })).toEqual([]);
    const spoken = cues.flatMap((c) => c.lines.join(' ').split(' ')).join(' ');
    expect(spoken).toBe(beats.map((b) => b.narration.trim().split(/\s+/).join(' ')).join(' '));
  });

  it('keeps cues inside their beat and in order', () => {
    for (const c of cues) {
      const b = beats[c.beatIndex]!;
      expect(c.startSec).toBeGreaterThanOrEqual(b.startSec - 1e-6);
      expect(c.endSec).toBeLessThanOrEqual(b.endSec + 1e-6);
      expect(c.endSec).toBeGreaterThan(c.startSec);
    }
    for (let i = 1; i < cues.length; i++) expect(cues[i]!.startSec).toBeGreaterThanOrEqual(cues[i - 1]!.endSec - 1e-6);
  });

  it('allocates time proportionally to word count within a beat', () => {
    const scaled = buildCaptionTimeline(beats, { wordsPerMinute: 150, narrationDurationSec: 35 });
    const inBeat = scaled.filter((c) => c.beatIndex === 2);
    expect(inBeat.length).toBeGreaterThan(1);
    const words = inBeat.map((c) => wc(c.lines.join(' ')));
    const dur = inBeat.map((c) => c.endSec - c.startSec);
    for (let i = 0; i < inBeat.length; i++) expect(dur[i]! / words[i]!).toBeCloseTo(dur[0]! / words[0]!, 2);
  });

  it('scales to the real narration duration', () => {
    const scaled = buildCaptionTimeline(beats, { wordsPerMinute: 150, narrationDurationSec: 70 });
    expect(scaled.at(-1)!.endSec).toBeCloseTo(70, 2);
    expect(scaleBeats(beats, 70).at(-1)!.endSec).toBeCloseTo(70, 2);
    expect(scaleBeats(beats)[0]!.endSec).toBe(beats[0]!.endSec);
  });

  it('does not stretch speech across a beat that is longer than the words need (no narration duration)', () => {
    const c = buildCaptionTimeline([{ startSec: 0, endSec: 20, narration: 'Just five short words here.' }], { wordsPerMinute: 150 });
    expect(c.at(-1)!.endSec).toBeCloseTo((5 * 60) / 150, 2);
  });

  it('rejects bad options', () => {
    expect(() => buildCaptionTimeline(beats, { wordsPerMinute: 0 })).toThrow();
  });
});

describe('checkCaptionLayout', () => {
  const cue = (lines: string[], s = 0, e = 1, index = 1): CaptionCue => ({ index, startSec: s, endSec: e, lines, beatIndex: 0 });
  it('reports overflow, too many lines, overlap, bad timing and empty cues', () => {
    const issues = checkCaptionLayout(
      [cue(['x'.repeat(40)]), cue(['a', 'b', 'c'], 0.5, 2, 2), cue([''], 3, 3, 3)],
      { maxCharsPerLine: 32, maxLines: 2 },
    );
    const codes = issues.map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['line_too_long', 'too_many_lines', 'overlap', 'bad_timing', 'empty_cue']));
  });
  it('reports a single over-long word instead of splitting it', () => {
    const c = buildCaptionTimeline([{ startSec: 0, endSec: 4, narration: `see ${'z'.repeat(40)} now` }], { wordsPerMinute: 150 });
    expect(c.flatMap((x) => x.lines)).toContain('z'.repeat(40));
    expect(checkCaptionLayout(c, { maxCharsPerLine: 32, maxLines: 2 }).some((i) => i.code === 'line_too_long')).toBe(true);
  });
  it('fits the configured caption style limits', () => {
    expect(CAPTION_STYLE.maxCharsPerLine).toBe(32);
  });
});

describe('SRT / VTT', () => {
  const cues: CaptionCue[] = [
    { index: 1, startSec: 0, endSec: 1.5, lines: ['Hello there,', 'world.'], beatIndex: 0 },
    { index: 2, startSec: 3661.0075, endSec: 3662, lines: ['Later.'], beatIndex: 0 },
  ];
  it('formats SRT', () => {
    expect(toSrt(cues)).toBe('1\n00:00:00,000 --> 00:00:01,500\nHello there,\nworld.\n\n2\n01:01:01,008 --> 01:01:02,000\nLater.\n');
  });
  it('formats VTT', () => {
    expect(toVtt(cues)).toBe('WEBVTT\n\n00:00:00.000 --> 00:00:01.500\nHello there,\nworld.\n\n01:01:01.008 --> 01:01:02.000\nLater.\n');
  });
});

describe('safe zones', () => {
  it('computes rectangles from fractions', () => {
    expect(safeRect({ top: 0.1, bottom: 0.2, left: 0.05, right: 0.15 }, { width: 1000, height: 2000 })).toEqual({ x: 50, y: 200, width: 800, height: 1400 });
  });
  it('provisional zones are valid and the cover zone sits inside the video frame', () => {
    expect(validateInsets(SAFE_ZONES.video)).toEqual([]);
    expect(validateInsets(SAFE_ZONES.cover)).toEqual([]);
    expect(validateInsets({ top: 0.6, bottom: 0.5, left: 0, right: 0 }).length).toBeGreaterThan(0);
    const frame = { x: 0, y: 0, width: FRAME.width, height: FRAME.height };
    expect(rectInside(safeRect(SAFE_ZONES.video), frame)).toBe(true);
    expect(rectInside(safeRect(SAFE_ZONES.cover), frame)).toBe(true);
  });
  it('captions at the configured size fit the safe width', () => {
    const w = safeRect(SAFE_ZONES.video).width;
    // Inter semibold averages about 0.6 em per character in worst-case mixed text.
    expect(CAPTION_STYLE.maxCharsPerLine * 0.6 * CAPTION_STYLE.fontSize + 88).toBeLessThan(w);
  });
});

describe('beat text helpers', () => {
  it('derives labels from visual text without inventing any', () => {
    expect(diagramLabels('[FIXTURE] Labelled diagram: app, operating system gate, location services.')).toEqual(['app', 'operating system gate', 'location services']);
    expect(checklistItems("So open your settings, check which apps have location access, and switch off any that don't need it.")).toEqual([
      'Open your settings',
      'Check which apps have location access',
      "Switch off any that don't need it",
    ]);
    expect(questionOf('Your phone asked. Who decides? Nobody knows.')).toBe('Who decides?');
  });
});

describe('manifest hashing', () => {
  const cues = buildCaptionTimeline(beats, { wordsPerMinute: 150 });
  const base: ManifestInputs = {
    mock: true,
    episodeCode: 'LU-TECH-001',
    scriptVersionId: 'v1',
    scriptSha256: 'a'.repeat(64),
    claimLedgerSha256: 'b'.repeat(64),
    template: 'EverydayMystery',
    fonts: [
      { family: 'Inter', weight: 700, file: 'b.woff2', sha256: 'c'.repeat(64), license: 'OFL-1.1' },
      { family: 'Inter', weight: 400, file: 'a.woff2', sha256: 'd'.repeat(64), license: 'OFL-1.1' },
    ],
    voice: 'mock',
    narrationSha256: 'e'.repeat(64),
    captionCues: cues,
    wordsPerMinute: 150,
    remotionVersion: '4.0.537',
    sampleSeconds: null,
  };
  it('is deterministic and independent of font order', () => {
    expect(inputsSha256(base)).toBe(inputsSha256({ ...base, fonts: [...base.fonts].reverse() }));
    expect(inputsSha256(base)).toMatch(/^[0-9a-f]{64}$/);
  });
  it('changes when any input changes', () => {
    const h = inputsSha256(base);
    expect(inputsSha256({ ...base, narrationSha256: 'f'.repeat(64) })).not.toBe(h);
    expect(inputsSha256({ ...base, template: 'TheUpdate' })).not.toBe(h);
    expect(inputsSha256({ ...base, mock: false })).not.toBe(h);
    expect(cuesSha256(cues)).not.toBe(cuesSha256(cues.slice(1)));
  });
});
