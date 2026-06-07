import type { CommitNode, FileStatusCode } from "./types";

export function parseLog(text: string): { commits: CommitNode[]; byHash: Record<string, CommitNode> } {
  const commits: CommitNode[] = [];
  const byHash: Record<string, CommitNode> = {};
  let current: CommitNode | null = null;

  for (const raw of text.replace(/\r/g, "").split("\n")) {
    if (!raw.trim()) continue;

    if (/^[ACDMRTUXB]\d*\t/.test(raw)) {
      if (!current) continue;
      const p = raw.split("\t");
      const code = p[0] as FileStatusCode;
      current.files.push(
        code[0] === "R" || code[0] === "C"
          ? { code, old: p[1], path: p[2] ?? p[1] }
          : { code, path: p[1] }
      );
      continue;
    }
    if (!raw.includes("|")) continue;

    const [hash, parents = "", refs = "", author = "", date = "", ...rest] = raw.split("|");
    const c: CommitNode = {
      hash: hash.trim(),
      parents: parents.trim() ? parents.trim().split(/\s+/) : [],
      author: author.trim(),
      date: date.trim(),
      subject: rest.join("|").trim(),
      branches: [], tags: [], head: false, files: [],
    };
    for (let r of refs.split(",")) {
      r = r.trim(); if (!r) continue;
      if (r.startsWith("tag: ")) c.tags.push(r.slice(5).trim());
      else if (r.includes("HEAD -> ")) { c.head = true; c.branches.push(r.split("->")[1].trim()); }
      else if (r === "HEAD") c.head = true;
      else c.branches.push(r);
    }
    commits.push(c); byHash[c.hash] = c; current = c;
  }
  return { commits, byHash };
}
