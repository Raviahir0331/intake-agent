import { describe, expect, it } from "vitest";
import { isSupportedNodeVersion } from "../src/checkNodeVersion";

describe("isSupportedNodeVersion", () => {
  it("rejects versions older than the minimum", () => {
    expect(isSupportedNodeVersion("v20.6.1", "22.13.0")).toBe(false);
    expect(isSupportedNodeVersion("22.12.0", "22.13.0")).toBe(false);
  });

  it("accepts the minimum and anything newer", () => {
    expect(isSupportedNodeVersion("22.13.0", "22.13.0")).toBe(true);
    expect(isSupportedNodeVersion("v22.23.2", "22.13.0")).toBe(true);
    expect(isSupportedNodeVersion("24.0.0", "22.13.0")).toBe(true);
  });
});
