import { describe, expect, it } from 'vitest';
import { CREATIVE_ISSUE_CODES, evaluateCreativeRules } from '../src/index';
import { beat, creative, expectBlocked, humanReview, proven, world } from './helpers';

describe('creative rules: engagement begging', () => {
  it.each([
    'Like and follow for more!',
    'Follow for more privacy tips.',
    'Subscribe to the series.',
    'Share this with a friend who needs it.',
    'Comment below which app surprised you.',
    'Let us know in the comments.',
    'Save this for later.',
    'Hit the button so you never miss one.',
    'Tap the like button if this helped.',
    'Turn on notifications.',
    'Full guide: link in bio.',
    'Double-tap if you learned something.',
    'Tag a friend who always taps allow.',
    'Give it a like.',
    'SMASH THAT LIKE BUTTON',
  ])('blocks "%s"', (text) => {
    const w = world();
    beat(w, 'twist').narration += ` ${text}`;
    expectBlocked(creative(w), 'engagement_bait');
  });

  it('blocks engagement appeals in the caption and visuals too', () => {
    const w = world();
    w.version.caption += '\nFollow us for part of the answer tomorrow';
    expectBlocked(creative(w), 'engagement_bait');
    const w2 = world();
    beat(w2, 'twist').visual = 'End card: "Subscribe" banner';
    expectBlocked(creative(w2), 'engagement_bait');
  });

  it.each([
    'Apps are likely to ask again later.',
    'It works like this: the system checks first.',
    'Apps may share location with partners, which is a shared memory of where you went.',
    'Follow these steps in settings.',
    'Researchers comment on the design of permission prompts.',
    'Tap the location button in settings to change it.',
    'This is unlike older phones.',
    'Save battery by limiting background access.',
  ])('does not flag the ordinary sentence "%s"', (text) => {
    const w = world();
    beat(w, 'problem').narration = text;
    expect(creative(w).issues).toEqual([]);
  });
});

describe('creative rules: withholding', () => {
  it.each([
    'The answer is in part two.',
    'Watch part 2 for the answer.',
    'Follow-up coming: stay tuned.',
    "You'll have to watch the next reel.",
    'Find out in the next episode.',
  ])('blocks "%s"', (text) => {
    const w = world();
    beat(w, 'twist').narration = `But location can sometimes be estimated another way. ${text}`;
    expectBlocked(creative(w), 'withholding_phrase');
  });

  it('allows an honest future-facing question', () => {
    const w = world();
    expect(beat(w, 'twist').narration).toMatch(/question worth asking next/);
    expect(creative(w).ok).toBe(true);
  });
});

describe('creative rules: beat order (resolve the promise before the twist)', () => {
  it('blocks a twist that comes before the takeaway', () => {
    const w = world();
    const b = w.version.beats;
    // Swap roles/text but keep the timings monotonic.
    const takeaway = b[3]!;
    const twist = b[4]!;
    [takeaway.role, twist.role] = [twist.role, takeaway.role];
    [takeaway.narration, twist.narration] = [twist.narration, takeaway.narration];
    [takeaway.claimIds, twist.claimIds] = [twist.claimIds, takeaway.claimIds];
    const r = creative(w);
    expectBlocked(r, 'twist_before_takeaway');
    expectBlocked(r, 'twist_not_last');
  });

  it('blocks a script with no takeaway (main promise never resolved)', () => {
    const w = world();
    w.version.beats = w.version.beats.filter((b) => b.role !== 'takeaway');
    const r = creative(w);
    expectBlocked(r, 'missing_takeaway');
    expectBlocked(r, 'twist_before_takeaway');
  });

  it('blocks more than one twist', () => {
    const w = world();
    const last = w.version.beats[4]!;
    w.version.beats.push({ ...last, startSec: 35, endSec: 38 });
    expectBlocked(creative(w), 'multiple_twists', { only: true });
  });

  it('blocks a twist that is not the final beat', () => {
    const w = world();
    const last = w.version.beats[4]!;
    w.version.beats.push({ ...w.version.beats[3]!, startSec: 35, endSec: 38 });
    expect(last.role).toBe('twist');
    expectBlocked(creative(w), 'twist_not_last', { only: true });
  });

  it('a script without a twist is fine (self-contained ending)', () => {
    const w = world();
    w.version.beats.pop();
    expect(creative(w).ok).toBe(true);
  });

  it.each(['mechanism', 'takeaway', 'twist'] as const)('blocks a %s beat that cites no claim (twist must be supported)', (role) => {
    const w = world();
    beat(w, role).claimIds = [];
    expectBlocked(creative(w), 'beat_without_claims', { only: true });
  });
});

describe('creative rules: timing', () => {
  it('blocks a beat whose end is not after its start', () => {
    const w = world();
    beat(w, 'problem').endSec = 3;
    expectBlocked(creative(w), 'beat_invalid_timing');
  });

  it('blocks overlapping beats', () => {
    const w = world();
    beat(w, 'mechanism').startSec = 8;
    expectBlocked(creative(w), 'beat_overlap', { only: true });
  });

  it('allows a gap between beats', () => {
    const w = world();
    beat(w, 'mechanism').startSec = 11;
    expect(creative(w).ok).toBe(true);
  });
});

describe('creative rules: connected endings', () => {
  it('blocks an ending that references a related episode without an id', () => {
    const w = world();
    w.link.endingReferencesRelated = true;
    w.relatedEpisodeLive = true;
    expectBlocked(creative(w), 'related_episode_missing', { only: true });
  });

  it('blocks an ending that references a related episode that is not live', () => {
    const w = world();
    w.link.endingReferencesRelated = true;
    w.link.relatedEpisodeId = 'fixture-episode-2';
    w.relatedEpisodeLive = false;
    expectBlocked(creative(w), 'related_episode_not_live', { only: true });
  });

  it('passes when the referenced episode is live', () => {
    const w = world();
    w.link.endingReferencesRelated = true;
    w.link.relatedEpisodeId = 'fixture-episode-2';
    w.relatedEpisodeLive = true;
    beat(w, 'twist').narration =
      'But your location can sometimes be estimated without that permission. Our linked episode explains how that works.';
    expect(creative(w).ok).toBe(true);
  });

  it('blocks narration that points to another Reel when the link does not declare it', () => {
    const w = world();
    beat(w, 'twist').narration =
      'But your location can sometimes be estimated without that permission. Watch our related episode to see how.';
    expectBlocked(creative(w), 'undeclared_related_reference', { only: true });
  });

  it('accepts a null link (standalone episode)', () => {
    const w = world();
    expect(evaluateCreativeRules({ version: w.version, link: null, relatedEpisodeLive: false, reviews: [] }).ok).toBe(true);
  });
});

describe('creative rules: appeals to authority', () => {
  it('blocks "experts agree" without an authorizing documented review', () => {
    const w = world();
    beat(w, 'mechanism').narration += ' Experts agree this is the safest setting.';
    expectBlocked(creative(w), 'authority_appeal', { only: true });
  });

  it('allows it with a documented review authorizing that wording', () => {
    const w = world();
    beat(w, 'mechanism').narration += ' Experts agree on how this works.';
    w.packet.reviews.push(humanReview({ id: 'h-agree', authorizedDisplayWording: 'Experts agree' }));
    expect(creative(w).ok).toBe(true);
  });
});

describe('creative rules: caption', () => {
  it('blocks a caption without the episode code', () => {
    const w = world();
    w.version.caption = w.version.caption.replace('LU-TECH-001', 'this episode');
    expectBlocked(creative(w), 'caption_missing_episode_code', { only: true });
  });
});

describe('creative rules coverage', () => {
  it('every creative issue code is exercised by a test in this file', () => {
    expect([...CREATIVE_ISSUE_CODES].filter((c) => !proven.has(c))).toEqual([]);
  });
});
