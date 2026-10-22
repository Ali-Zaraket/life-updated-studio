export const RESULTS = ['improved', 'no_difference', 'worse', 'insufficient_evidence'] as const;
export const DECISIONS = ['promote', 'keep_baseline', 'continue_collecting', 'roll_back'] as const;
export type ExperimentResult = (typeof RESULTS)[number];
export type ExperimentDecision = (typeof DECISIONS)[number];

export interface DecisionInput {
  result: string;
  decision: string;
  rollback: string;
  evidenceSummary: string;
}
export type DecisionCheck = { ok: true; result: string; decision: string; rollback: string } | { ok: false; reason: string };

/**
 * Brief section 7: observational comparisons only. "Promote" needs a typed evidence summary and a
 * result that is not "insufficient evidence"/"worse"; the rollback note is always required.
 */
export function checkDecision(i: DecisionInput): DecisionCheck {
  if (!(RESULTS as readonly string[]).includes(i.result)) return { ok: false, reason: 'Choose a result.' };
  if (!(DECISIONS as readonly string[]).includes(i.decision)) return { ok: false, reason: 'Choose a decision.' };
  const rollback = i.rollback.trim();
  if (rollback.length < 3) return { ok: false, reason: 'A rollback note is required.' };
  const evidence = i.evidenceSummary.trim();
  if (i.decision === 'promote') {
    if (evidence.length < 20) return { ok: false, reason: 'Promoting requires an evidence summary you typed (at least 20 characters): posts compared, reach, confounds checked.' };
    if (i.result === 'insufficient_evidence' || i.result === 'worse') return { ok: false, reason: `Cannot promote when the result is "${i.result}".` };
  }
  const result = evidence ? `${i.result}: ${evidence}` : i.result;
  return { ok: true, result, decision: i.decision, rollback };
}

/** Readable summary stored in `change`; the structured `variable` and `baseline_template` columns are set alongside. */
export function composeChange(variable: string, baseline: string): string {
  return `Variable changed (one only): ${variable.trim()}\nBaseline template: ${baseline.trim()}`;
}
