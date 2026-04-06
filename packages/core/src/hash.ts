import { createHash } from "node:crypto";
import { DEFAULT_DECIMALS } from "@kiploks/engine-contracts";
import { canonicalStringify } from "./canonical";

export function hashCanonical(value: unknown, decimals = DEFAULT_DECIMALS): string {
  const payload = canonicalStringify(value, decimals);
  return createHash("sha256").update(payload, "utf8").digest("hex");
}
