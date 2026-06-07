import type { CommitNode, LaneModel } from "./types";
import { LAYOUT } from "./layout";

function priority(name: string): [number, string] {
  if (name === "main" || name === "master") return [0, name];
  if (name === "develop" || name === "dev")  return [1, name];
  return [2, name];
}

export function assignLanes(
  commits: CommitNode[],
  byHash: Record<string, CommitNode>
): LaneModel {
  const tips: Record<string, { name: string; tip: string; remote: boolean }> = {};
  for (const c of commits)
    for (const b of c.branches) {
      const norm = b.replace(/^origin\//, "");
      if (!(norm in tips)) tips[norm] = { name: norm, tip: c.hash, remote: b !== norm };
      else if (tips[norm].remote && b === norm) tips[norm] = { name: norm, tip: c.hash, remote: false };
    }

  const branches = Object.values(tips).sort((a, b) => {
    const pa = priority(a.name), pb = priority(b.name);
    return pa[0] - pb[0] || pa[1].localeCompare(pb[1]);
  });

  const laneOf: Record<string, number> = {};
  const branchOf: Record<string, string> = {};
  branches.forEach((b, lane) => {
    let cur: string | undefined = b.tip;
    while (cur && byHash[cur] && laneOf[cur] === undefined) {
      laneOf[cur] = lane;
      branchOf[cur] = b.name;
      cur = byHash[cur].parents[0];
    }
  });

  let extra: number | null = null;
  for (const c of commits)
    if (laneOf[c.hash] === undefined) {
      if (extra === null) extra = branches.length;
      laneOf[c.hash] = extra; branchOf[c.hash] = "(no branch ref)";
    }

  const laneNames = branches.map(b => b.name);
  if (extra !== null) laneNames.push("(no branch ref)");

  const rowOf: Record<string, number> = {};
  commits.forEach((c, i) => (rowOf[c.hash] = i));

  return {
    commits, byHash, laneOf, branchOf, laneNames,
    nLanes: laneNames.length, rowOf,
    graphW: LAYOUT.LP + laneNames.length * LAYOUT.laneW + LAYOUT.RP,
  };
}
