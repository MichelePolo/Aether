import { assignLanes } from "./lanes";
import { LAYOUT } from "./layout";
import type { CommitNode } from "./types";

function commit(
  hash: string,
  parents: string[],
  branches: string[] = []
): CommitNode {
  return {
    hash,
    parents,
    author: "a",
    date: "d",
    subject: "s",
    branches,
    tags: [],
    head: false,
    files: [],
  };
}

function model(commits: CommitNode[]) {
  const byHash: Record<string, CommitNode> = {};
  for (const c of commits) byHash[c.hash] = c;
  return { commits, byHash };
}

describe("assignLanes", () => {
  it("places main on lane 0, develop on lane 1, others alphabetical after", () => {
    const commits = [
      commit("m1", [], ["main"]),
      commit("d1", [], ["develop"]),
      commit("z1", [], ["zebra"]),
      commit("a1", [], ["apple"]),
    ];
    const { commits: cs, byHash } = model(commits);
    const lm = assignLanes(cs, byHash);
    expect(lm.laneNames).toEqual(["main", "develop", "apple", "zebra"]);
    expect(lm.laneOf["m1"]).toBe(0);
    expect(lm.laneOf["d1"]).toBe(1);
    expect(lm.laneOf["a1"]).toBe(2);
    expect(lm.laneOf["z1"]).toBe(3);
    expect(lm.branchOf["m1"]).toBe("main");
    expect(lm.nLanes).toBe(4);
    expect(lm.graphW).toBe(LAYOUT.LP + 4 * LAYOUT.laneW + LAYOUT.RP);
  });

  it("keeps a feature branch's commits in its own lane after a first-parent merge", () => {
    // main tip = merge (M2), parents[0] = M1 (old main tip), parents[1] = F1 (feature)
    const commits = [
      commit("M2", ["M1", "F1"], ["main"]),
      commit("F1", ["M1"], ["feature"]),
      commit("M1", ["M0"]),
      commit("M0", []),
    ];
    const { commits: cs, byHash } = model(commits);
    const lm = assignLanes(cs, byHash);
    // main lane (0) walks first-parents: M2 -> M1 -> M0
    expect(lm.laneOf["M2"]).toBe(0);
    expect(lm.laneOf["M1"]).toBe(0);
    expect(lm.laneOf["M0"]).toBe(0);
    expect(lm.branchOf["M2"]).toBe("main");
    // feature lane keeps F1 (its tip) because main already claimed M1
    expect(lm.laneOf["F1"]).toBe(1);
    expect(lm.branchOf["F1"]).toBe("feature");
    expect(lm.laneNames).toEqual(["main", "feature"]);
  });

  it("dedups origin/main + main into one lane named main, preferring the local tip", () => {
    // remote tip seen first (older commit), then local tip on a newer commit
    const commits = [
      commit("local", ["remote"], ["main"]),
      commit("remote", [], ["origin/main"]),
    ];
    const { commits: cs, byHash } = model(commits);
    const lm = assignLanes(cs, byHash);
    expect(lm.laneNames).toEqual(["main"]);
    expect(lm.nLanes).toBe(1);
    // local is the preferred tip, so the lane walk starts there and covers both
    expect(lm.laneOf["local"]).toBe(0);
    expect(lm.laneOf["remote"]).toBe(0);
    expect(lm.branchOf["local"]).toBe("main");
  });

  it("keeps a remote-only branch named without the origin/ prefix", () => {
    const commits = [commit("r1", [], ["origin/feature"])];
    const { commits: cs, byHash } = model(commits);
    const lm = assignLanes(cs, byHash);
    expect(lm.laneNames).toEqual(["feature"]);
    expect(lm.branchOf["r1"]).toBe("feature");
  });

  it("adds a (no branch ref) fallback lane for unreferenced commits", () => {
    const commits = [
      commit("m1", ["orphan"], ["main"]),
      commit("orphan", []),
    ];
    // make orphan NOT reachable via first-parent from main by giving main a different parent[0]
    commits[0].parents = ["x"]; // dead-end parent not in byHash
    const { commits: cs, byHash } = model(commits);
    const lm = assignLanes(cs, byHash);
    expect(lm.laneNames).toEqual(["main", "(no branch ref)"]);
    expect(lm.nLanes).toBe(2);
    expect(lm.laneOf["m1"]).toBe(0);
    expect(lm.laneOf["orphan"]).toBe(1);
    expect(lm.branchOf["orphan"]).toBe("(no branch ref)");
    expect(lm.graphW).toBe(LAYOUT.LP + 2 * LAYOUT.laneW + LAYOUT.RP);
  });

  it("builds rowOf in commit order", () => {
    const commits = [commit("a", []), commit("b", []), commit("c", [])];
    const { commits: cs, byHash } = model(commits);
    const lm = assignLanes(cs, byHash);
    expect(lm.rowOf).toEqual({ a: 0, b: 1, c: 2 });
  });

  it("handles an empty commit list", () => {
    const lm = assignLanes([], {});
    expect(lm.laneNames).toEqual([]);
    expect(lm.nLanes).toBe(0);
    expect(lm.commits).toEqual([]);
  });
});
