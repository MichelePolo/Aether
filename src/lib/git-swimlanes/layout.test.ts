import { LAYOUT, laneX, PANEL, panelHeight, computeOffsets } from "./layout";
import type { CommitNode, LaneModel } from "./types";

function commit(hash: string, fileCount: number): CommitNode {
  return {
    hash,
    parents: [],
    author: "a",
    date: "d",
    subject: "s",
    branches: [],
    tags: [],
    head: false,
    files: Array.from({ length: fileCount }, (_, i) => ({
      code: "M" as const,
      path: `f${i}`,
    })),
  };
}

function lm(commits: CommitNode[]): LaneModel {
  return {
    commits,
    byHash: {},
    laneOf: {},
    branchOf: {},
    laneNames: [],
    nLanes: 0,
    rowOf: {},
    graphW: 0,
  };
}

describe("laneX", () => {
  it("computes the center x of a lane", () => {
    expect(laneX(0)).toBe(LAYOUT.LP + LAYOUT.laneW / 2); // 16 + 14 = 30
    expect(laneX(0)).toBe(30);
    expect(laneX(1)).toBe(LAYOUT.LP + LAYOUT.laneW + LAYOUT.laneW / 2);
  });
});

describe("panelHeight", () => {
  it("returns padV + lineH (42) for 0 files", () => {
    expect(panelHeight(commit("a", 0))).toBe(PANEL.padV + PANEL.lineH);
    expect(panelHeight(commit("a", 0))).toBe(42);
  });

  it("returns padV + lineH (42) for 1 file", () => {
    expect(panelHeight(commit("a", 1))).toBe(42);
  });

  it("grows with file count", () => {
    expect(panelHeight(commit("a", 3))).toBe(PANEL.padV + 3 * PANEL.lineH); // 90
  });

  it("caps at 250 for many files", () => {
    expect(panelHeight(commit("a", 1000))).toBe(PANEL.cap);
    expect(panelHeight(commit("a", 1000))).toBe(250);
  });
});

describe("computeOffsets", () => {
  it("returns tops as multiples of rowH when nothing is expanded", () => {
    const m = lm([commit("a", 0), commit("b", 0), commit("c", 0)]);
    const { top, totalH, dotY } = computeOffsets(m, new Set());
    expect(top).toEqual([0, LAYOUT.rowH, 2 * LAYOUT.rowH]);
    expect(top).toEqual([0, 46, 92]);
    expect(totalH).toBe(3 * LAYOUT.rowH);
    expect(dotY(0)).toBe(LAYOUT.rowH / 2); // 23
    expect(dotY(1)).toBe(top[1] + 23);
  });

  it("shifts subsequent tops by the expanded panel height", () => {
    const a = commit("a", 2); // panelHeight = 18 + 48 = 66
    const m = lm([a, commit("b", 0), commit("c", 0)]);
    const { top, totalH } = computeOffsets(m, new Set(["a"]));
    const ph = panelHeight(a);
    expect(top[0]).toBe(0);
    expect(top[1]).toBe(LAYOUT.rowH + ph);
    expect(top[2]).toBe((LAYOUT.rowH + ph) + LAYOUT.rowH);
    expect(totalH).toBe(top[2] + LAYOUT.rowH);
  });

  it("handles an empty commit list", () => {
    const { top, totalH } = computeOffsets(lm([]), new Set());
    expect(top).toEqual([]);
    expect(totalH).toBe(0);
  });
});
