import { classifyDiffLine } from "./diff";

describe("classifyDiffLine", () => {
  it("classifies hunk headers", () => {
    expect(classifyDiffLine("@@ -1,4 +1,6 @@")).toBe("hunk");
  });

  it("classifies meta lines", () => {
    expect(classifyDiffLine("+++ b/file.ts")).toBe("meta");
    expect(classifyDiffLine("--- a/file.ts")).toBe("meta");
    expect(classifyDiffLine("diff --git a/x b/x")).toBe("meta");
    expect(classifyDiffLine("index abc..def 100644")).toBe("meta");
    expect(classifyDiffLine("new file mode 100644")).toBe("meta");
    expect(classifyDiffLine("deleted file mode 100644")).toBe("meta");
    expect(classifyDiffLine("similarity index 95%")).toBe("meta");
    expect(classifyDiffLine("rename from old")).toBe("meta");
  });

  it("classifies added lines", () => {
    expect(classifyDiffLine("+const x = 1;")).toBe("add");
  });

  it("classifies deleted lines", () => {
    expect(classifyDiffLine("-const x = 1;")).toBe("del");
  });

  it("classifies context lines", () => {
    expect(classifyDiffLine(" unchanged line")).toBe("ctx");
    expect(classifyDiffLine("")).toBe("ctx");
  });

  it("prioritizes meta over add for +++ lines (order matters)", () => {
    expect(classifyDiffLine("+++ b/x")).toBe("meta");
    expect(classifyDiffLine("+code")).toBe("add");
  });

  it("prioritizes meta over del for --- lines (order matters)", () => {
    expect(classifyDiffLine("--- a/x")).toBe("meta");
    expect(classifyDiffLine("-code")).toBe("del");
  });
});
