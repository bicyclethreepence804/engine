import { afterEach, describe, expect, it, vi } from "vitest";
import { engineInfo, engineWarn } from "./logger";

describe("logger gating", () => {
  const oldValue = process.env.KIPLOKS_ENGINE_DEBUG;

  afterEach(() => {
    process.env.KIPLOKS_ENGINE_DEBUG = oldValue;
    vi.restoreAllMocks();
  });

  it("does not log when debug flag is disabled", () => {
    process.env.KIPLOKS_ENGINE_DEBUG = "false";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);

    engineWarn("w");
    engineInfo("i");

    expect(warnSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it("logs when debug flag is enabled", () => {
    process.env.KIPLOKS_ENGINE_DEBUG = "true";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);

    engineWarn("w");
    engineInfo("i");

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy).toHaveBeenCalledTimes(1);
  });
});
