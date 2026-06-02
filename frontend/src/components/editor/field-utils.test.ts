import { describe, expect, it } from "vitest";
import { isFieldEqual } from "./field-utils";

describe("isFieldEqual", () => {
  it("normalizes YAML-ish optional values and numeric strings", () => {
    expect(isFieldEqual("same", "same")).toBe(true);
    expect(isFieldEqual(null, undefined)).toBe(true);
    expect(isFieldEqual(12, "12")).toBe(true);
    expect(isFieldEqual("12", 12)).toBe(true);
  });

  it("keeps genuinely different values unequal", () => {
    expect(isFieldEqual(12, "12.0")).toBe(false);
    expect(isFieldEqual("12.0", 12)).toBe(false);
    expect(isFieldEqual(false, undefined)).toBe(false);
  });
});
