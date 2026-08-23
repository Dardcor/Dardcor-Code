// Guards the deduped Antigravity OAuth client: same values across all 3 sources after refactor.
import { describe, it, expect } from "vitest";

describe("antigravity oauth client (deduped)", () => {
  it("shared source holds the canonical credentials object", async () => {
    const { ANTIGRAVITY_OAUTH_CLIENT } = await import("../../open-sse/providers/shared.js");
    expect(ANTIGRAVITY_OAUTH_CLIENT).toBeDefined();
    expect(typeof ANTIGRAVITY_OAUTH_CLIENT).toBe("object");
  });

  it("registry transport keeps clientId/clientSecret properties", async () => {
    const ag = (await import("../../open-sse/providers/registry/antigravity.js")).default;
    const { ANTIGRAVITY_OAUTH_CLIENT } = await import("../../open-sse/providers/shared.js");
    expect(ag.transport.clientId).toBe(ANTIGRAVITY_OAUTH_CLIENT.clientId);
    expect(ag.transport.clientSecret).toBe(ANTIGRAVITY_OAUTH_CLIENT.clientSecret);
  });

  it("google client shared by gemini + gemini-cli", async () => {
    const { GOOGLE_OAUTH_CLIENT } = await import("../../open-sse/providers/shared.js");
    expect(GOOGLE_OAUTH_CLIENT).toBeDefined();
    const gemini = (await import("../../open-sse/providers/registry/gemini.js")).default;
    const gc = (await import("../../open-sse/providers/registry/gemini-cli.js")).default;
    expect(gemini.transport.clientSecret).toBe(GOOGLE_OAUTH_CLIENT.clientSecret);
    expect(gc.transport.clientSecret).toBe(GOOGLE_OAUTH_CLIENT.clientSecret);
  });
});
