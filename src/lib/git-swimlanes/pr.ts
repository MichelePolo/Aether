import type { PullRequestRef } from "./types";

export function detectPR(subject: string): PullRequestRef | null {
  let m: RegExpMatchArray | null;
  if ((m = subject.match(/^Merged PR (\d+)/i)))           return { id: m[1], src: "Azure DevOps" };
  if ((m = subject.match(/Merge pull request #(\d+)/i)))  return { id: m[1], src: "GitHub" };
  if ((m = subject.match(/\bpull request #(\d+)/i)))      return { id: m[1], src: "Bitbucket" };
  if ((m = subject.match(/merge request[^!]*!(\d+)/i)))   return { id: m[1], src: "GitLab" };
  if ((m = subject.match(/\(#(\d+)\)\s*$/)))              return { id: m[1], src: "squash" };
  return null;
}
