/**
 * Safe zones for overlay text, as fractions of the frame.
 *
 * PROVISIONAL: these are conservative estimates of where the Instagram Reels UI (profile/audio header at the
 * top, caption + buttons at the bottom, action column on the right) covers the frame. They have NOT been
 * checked against the current Instagram interface on a real device. Verify on a phone and adjust here;
 * every template reads these constants, so one edit changes all layouts.
 */
export interface Insets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export const FRAME = { width: 2160, height: 3840, fps: 30 } as const;

/** Video safe zone for titles, diagrams and burned-in captions. PROVISIONAL. */
export const SAFE_ZONES: { video: Insets; cover: Insets } = {
  video: { top: 0.12, bottom: 0.22, left: 0.07, right: 0.13 },
  /**
   * Cover safe zone: also keeps important elements inside the centered 3:4 crop used by the profile grid
   * (12.5% off top and bottom of a 9:16 frame) plus margin. PROVISIONAL.
   */
  cover: { top: 0.16, bottom: 0.16, left: 0.1, right: 0.1 },
};

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function safeRect(insets: Insets, frame: { width: number; height: number } = FRAME): Rect {
  const x = Math.round(frame.width * insets.left);
  const y = Math.round(frame.height * insets.top);
  const right = Math.round(frame.width * (1 - insets.right));
  const bottom = Math.round(frame.height * (1 - insets.bottom));
  return { x, y, width: right - x, height: bottom - y };
}

export function rectInside(inner: Rect, outer: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

export function validateInsets(i: Insets): string[] {
  const issues: string[] = [];
  for (const [k, v] of Object.entries(i)) {
    if (!(v >= 0 && v < 0.5)) issues.push(`${k} inset ${v} must be within [0, 0.5)`);
  }
  if (i.left + i.right >= 1) issues.push('left + right insets leave no width');
  if (i.top + i.bottom >= 1) issues.push('top + bottom insets leave no height');
  return issues;
}
