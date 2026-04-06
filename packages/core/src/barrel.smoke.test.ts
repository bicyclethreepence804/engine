import { describe, expect, it } from "vitest";

describe("package barrels execute", () => {
  it("loads public index exports", async () => {
    const mod = await import("./index");
    expect(typeof mod.analyze).toBe("function");
    expect(typeof mod.analyzeFromWindows).toBe("function");
    expect(typeof mod.analyzeFromTrades).toBe("function");
    expect(typeof mod.sliceTradesIntoWindows).toBe("function");
    expect(typeof mod.hashCanonical).toBe("function");
    expect(typeof mod.calculateMean).toBe("function");
  });

  it("loads internal subpath surface", async () => {
    const mod = await import("./internal");
    expect(typeof mod.runIntegrityJudge).toBe("function");
  });
});
