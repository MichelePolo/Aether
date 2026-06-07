import { parseLog } from "./parse";

describe("parseLog", () => {
  it("parses a multi-commit log with header + name-status rows", () => {
    const log = [
      "aaa|bbb|HEAD -> main|Alice|2026-01-01|Initial commit",
      "M\tsrc/app.ts",
      "A\tsrc/new.ts",
      "bbb||tag: v1|Bob|2025-12-31|Older commit",
      "D\tsrc/old.ts",
    ].join("\n");

    const { commits, byHash } = parseLog(log);
    expect(commits).toHaveLength(2);

    const first = byHash["aaa"];
    expect(first.parents).toEqual(["bbb"]);
    expect(first.author).toBe("Alice");
    expect(first.date).toBe("2026-01-01");
    expect(first.subject).toBe("Initial commit");
    expect(first.head).toBe(true);
    expect(first.branches).toEqual(["main"]);
    expect(first.files).toEqual([
      { code: "M", path: "src/app.ts" },
      { code: "A", path: "src/new.ts" },
    ]);

    const second = byHash["bbb"];
    expect(second.parents).toEqual([]);
    expect(second.tags).toEqual(["v1"]);
    expect(second.files).toEqual([{ code: "D", path: "src/old.ts" }]);
  });

  it("parses a rename row into code/old/path", () => {
    const log = [
      "aaa|||A|2026-01-01|s",
      "R100\told\tnew",
    ].join("\n");
    const { byHash } = parseLog(log);
    expect(byHash["aaa"].files).toEqual([{ code: "R100", old: "old", path: "new" }]);
  });

  it("parses a copy row into code/old/path", () => {
    const log = ["aaa|||A|2026-01-01|s", "C75\tsource\tcopy"].join("\n");
    const { byHash } = parseLog(log);
    expect(byHash["aaa"].files).toEqual([{ code: "C75", old: "source", path: "copy" }]);
  });

  it("falls back to old path when rename has no third column", () => {
    const log = ["aaa|||A|2026-01-01|s", "R100\tonly"].join("\n");
    const { byHash } = parseLog(log);
    expect(byHash["aaa"].files).toEqual([{ code: "R100", old: "only", path: "only" }]);
  });

  it("preserves a subject containing a pipe", () => {
    const log = "aaa|||A|2026-01-01|fix: handle a|b|c case";
    const { byHash } = parseLog(log);
    expect(byHash["aaa"].subject).toBe("fix: handle a|b|c case");
  });

  it("parses HEAD -> main into head + branch", () => {
    const { byHash } = parseLog("aaa||HEAD -> main|A|d|s");
    expect(byHash["aaa"].head).toBe(true);
    expect(byHash["aaa"].branches).toEqual(["main"]);
  });

  it("parses tag: prefixed refs into tags", () => {
    const { byHash } = parseLog("aaa||tag: v1.2.3|A|d|s");
    expect(byHash["aaa"].tags).toEqual(["v1.2.3"]);
  });

  it("parses a plain branch ref", () => {
    const { byHash } = parseLog("aaa||feature/x|A|d|s");
    expect(byHash["aaa"].branches).toEqual(["feature/x"]);
  });

  it("parses a bare HEAD ref as head without a branch", () => {
    const { byHash } = parseLog("aaa||HEAD|A|d|s");
    expect(byHash["aaa"].head).toBe(true);
    expect(byHash["aaa"].branches).toEqual([]);
  });

  it("parses multiple comma-separated refs", () => {
    const { byHash } = parseLog("aaa||HEAD -> main, origin/main, tag: v1|A|d|s");
    const c = byHash["aaa"];
    expect(c.head).toBe(true);
    expect(c.branches).toEqual(["main", "origin/main"]);
    expect(c.tags).toEqual(["v1"]);
  });

  it("ignores blank lines and whitespace-only lines", () => {
    const log = ["", "   ", "aaa|||A|d|s", "", "\t"].join("\n");
    const { commits } = parseLog(log);
    expect(commits).toHaveLength(1);
  });

  it("ignores a file row that has no current commit", () => {
    const { commits } = parseLog("M\torphan.ts");
    expect(commits).toHaveLength(0);
  });

  it("ignores non-pipe, non-file lines", () => {
    const { commits } = parseLog("this is just noise");
    expect(commits).toHaveLength(0);
  });

  it("strips carriage returns", () => {
    const { byHash } = parseLog("aaa|||A|d|s\r\nM\tfile.ts\r");
    expect(byHash["aaa"].files).toEqual([{ code: "M", path: "file.ts" }]);
  });
});
