import { hueFromName, colorFor } from "./color";

describe("hueFromName", () => {
  it("is deterministic across calls", () => {
    expect(hueFromName("feature/login")).toBe(hueFromName("feature/login"));
    expect(hueFromName("main")).toBe(hueFromName("main"));
  });

  it("returns a hue in [0, 360)", () => {
    for (const name of ["main", "develop", "feature/x", "", "a", "zzzzzzzzzz", "😀"]) {
      const h = hueFromName(name);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
      expect(Number.isInteger(h)).toBe(true);
    }
  });

  it("produces different hues for different names (generally)", () => {
    expect(hueFromName("main")).not.toBe(hueFromName("develop"));
  });
});

describe("colorFor", () => {
  it("returns the gray for the no-branch-ref sentinel", () => {
    expect(colorFor("(no branch ref)")).toBe("hsl(215 10% 50%)");
  });

  it("returns an hsl color with 68% 60% for normal names", () => {
    expect(colorFor("main")).toBe(`hsl(${hueFromName("main")} 68% 60%)`);
    expect(colorFor("feature/x")).toMatch(/^hsl\(\d+ 68% 60%\)$/);
  });
});
