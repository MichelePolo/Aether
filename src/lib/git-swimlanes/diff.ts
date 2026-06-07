export function classifyDiffLine(l: string):
  "hunk" | "meta" | "add" | "del" | "ctx" {
  if (l.startsWith("@@")) return "hunk";
  if (/^(\+\+\+|---|diff |index |new file|deleted file|similarity|rename )/.test(l)) return "meta";
  if (l.startsWith("+")) return "add";
  if (l.startsWith("-")) return "del";
  return "ctx";
}
