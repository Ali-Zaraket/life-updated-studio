/**
 * Pure helpers that derive on-screen text from a beat. Nothing is invented: every string shown on screen is
 * a substring or split of the beat's own narration or visual text.
 */

/** Remove a leading "[FIXTURE]" style tag from visual text. */
export function stripTag(s: string): string {
  return s.replace(/^\s*\[[^\]]*\]\s*/, '').trim();
}

export function sentencesOf(text: string): string[] {
  const out = text.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) ?? [];
  return out.map((s) => s.trim()).filter((s) => s.length > 0);
}

/** The question for a hook/twist card: the first sentence ending in "?", else the first sentence. */
export function questionOf(narration: string): string {
  const s = sentencesOf(narration);
  return s.find((x) => x.endsWith('?')) ?? s[0] ?? narration.trim();
}

export function firstSentence(narration: string): string {
  return sentencesOf(narration)[0] ?? narration.trim();
}

const MAX_LABEL_WORDS = 5;
const MAX_LABELS = 5;

/** Node labels for a diagram, taken from the beat's visual text ("Labelled diagram: app, gate, services."). */
export function diagramLabels(visual: string): string[] {
  let v = stripTag(visual);
  const colon = v.indexOf(':');
  if (colon >= 0) v = v.slice(colon + 1);
  v = v.replace(/[.]+$/, '');
  const parts = v
    .split(/\s*(?:,|;|→|->|\band then\b|\band\b)\s*/i)
    .map((p) => p.replace(/^(?:a|an|the)\s+/i, '').trim())
    .filter((p) => p.length > 0)
    .map((p) => p.split(/\s+/).slice(0, MAX_LABEL_WORDS).join(' '));
  return parts.slice(0, MAX_LABELS);
}

/** Action items for a takeaway card, split from the narration at commas and "and". */
export function checklistItems(narration: string): string[] {
  const s = firstSentence(narration)
    .replace(/[.!?]+$/, '')
    .replace(/^(?:so|now|and)\s+/i, '');
  const parts = s
    .split(/\s*(?:,\s*(?:and\s+)?|\s+and\s+)/i)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const items = parts.length >= 2 ? parts : [s];
  return items.slice(0, 4).map((p) => p.charAt(0).toUpperCase() + p.slice(1));
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
