import { detectPR } from "./pr";

describe("detectPR", () => {
  it("detects Azure DevOps merges", () => {
    expect(detectPR("Merged PR 1042: Add feature")).toEqual({ id: "1042", src: "Azure DevOps" });
  });

  it("detects GitHub merges", () => {
    expect(detectPR("Merge pull request #42 from org/feature")).toEqual({ id: "42", src: "GitHub" });
  });

  it("detects Bitbucket pull requests", () => {
    expect(detectPR("Merge branch feature (pull request #42)")).toEqual({ id: "42", src: "Bitbucket" });
  });

  it("detects GitLab merge requests", () => {
    expect(detectPR("Merge branch x into main See merge request group/proj!42")).toEqual({
      id: "42",
      src: "GitLab",
    });
  });

  it("detects squash-style references", () => {
    expect(detectPR("Add login (#42)")).toEqual({ id: "42", src: "squash" });
  });

  it("prefers GitHub over Bitbucket when both could match", () => {
    expect(detectPR("Merge pull request #7 from x")).toEqual({ id: "7", src: "GitHub" });
  });

  it("returns null for non-matching subjects", () => {
    expect(detectPR("Just a normal commit message")).toBeNull();
  });
});
