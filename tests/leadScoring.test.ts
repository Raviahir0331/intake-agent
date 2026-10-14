import { describe, expect, it } from "vitest";
import { hasInboundRequest, isConnected, scoreLead } from "../src/agent/leadScoring";
import { makeLead } from "./helpers";

describe("lead scoring", () => {
  it("spots inbound requests in either column", () => {
    expect(
      hasInboundRequest(makeLead({ connectionNote: "Requested a demo via website form" })),
    ).toBe(true);
    expect(
      hasInboundRequest(
        makeLead({ connectionNote: "Requested pricing info via LinkedIn message" }),
      ),
    ).toBe(true);
    expect(
      hasInboundRequest(makeLead({ recentActivity: "Requested a call after the webinar" })),
    ).toBe(true);
    expect(hasInboundRequest(makeLead())).toBe(false);
  });

  it("only treats 'Connected ...' notes as an existing connection", () => {
    expect(
      isConnected(makeLead({ connectionNote: "Connected via mutual dental association group" })),
    ).toBe(true);
    expect(isConnected(makeLead({ connectionNote: "Mutual connection: former colleague" }))).toBe(
      false,
    );
  });

  it("scores an engaged decision maker with a warm intro as warm", () => {
    const score = scoreLead(
      makeLead({
        jobTitle: "Owner",
        recentActivity: "Commented asking about missed call recovery tools",
        connectionNote: "Warm intro from existing client",
      }),
    );
    expect(score.suggestedTier).toBe("warm");
    expect(score.reasons).toContain("+25 warm introduction");
  });

  it("scores a dormant cold profile as cold", () => {
    const score = scoreLead(
      makeLead({
        recentActivity: "No recent activity, dormant profile",
        connectionNote: "Cold outreach",
      }),
    );
    expect(score.suggestedTier).toBe("cold");
    expect(score.score).toBeLessThan(30);
  });
});
