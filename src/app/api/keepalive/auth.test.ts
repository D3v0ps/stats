import { describe, expect, it } from "vitest";
import { isAuthorizedCron } from "./auth";

describe("isAuthorizedCron", () => {
  it("requires the bearer secret when one is configured", () => {
    expect(isAuthorizedCron("Bearer s3cret", "s3cret")).toBe(true);
    expect(isAuthorizedCron("Bearer wrong", "s3cret")).toBe(false);
    expect(isAuthorizedCron(null, "s3cret")).toBe(false);
  });
  it("stays open when no secret is configured", () => {
    expect(isAuthorizedCron(null, undefined)).toBe(true);
    expect(isAuthorizedCron(null, "  ")).toBe(true);
  });
});
