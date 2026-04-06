import { describe, expect, it } from "vitest";
import { canonicalStringify } from "./canonical";

describe("canonical stringification", () => {
  it("keeps deterministic key order", () => {
    const payloadA = { b: 1, a: 2 };
    const payloadB = { a: 2, b: 1 };

    expect(canonicalStringify(payloadA, 8)).toEqual(canonicalStringify(payloadB, 8));
  });

  it("uses scaled number form", () => {
    const payload = { value: 0.1 + 0.2 };
    expect(canonicalStringify(payload, 8)).toContain('"v":"30000000"');
    expect(canonicalStringify(payload, 8)).toContain('"scale":8');
  });
});
