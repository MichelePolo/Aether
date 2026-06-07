import type { CommitNode, LaneModel } from "./types";

export const LAYOUT = {
  LP: 16, laneW: 28, RP: 10, rowH: 46, dotR: 6, mergeR: 7.5,
} as const;

export const laneX = (i: number) => LAYOUT.LP + i * LAYOUT.laneW + LAYOUT.laneW / 2;

export const PANEL = { lineH: 24, padV: 18, cap: 250 };

export function panelHeight(c: CommitNode): number {
  const n = Math.max(c.files.length, 1);
  return Math.min(PANEL.padV + n * PANEL.lineH, PANEL.cap);
}

export function computeOffsets(m: LaneModel, expanded: Set<string>) {
  const top: number[] = [];
  let y = 0;
  for (const c of m.commits) {
    top.push(y);
    y += LAYOUT.rowH + (expanded.has(c.hash) ? panelHeight(c) : 0);
  }
  const dotY = (i: number) => top[i] + LAYOUT.rowH / 2;
  return { top, totalH: y, dotY };
}
