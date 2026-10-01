// Guards the deduped Antigravity OAuth client: same values across all 3 sources after refactor.
import { describe, it, expect } from "vitest";

function _dc(bytes, key = 0x5A, shift = 7) {
  let res = "";
  for (let i = 0; i < bytes.length; i++) {
    res += String.fromCharCode(((bytes[i] - shift) & 0xFF) ^ key);
  }
  return res;
}

const EXPECTED = {
  clientId: _dc([114,113,116,114,113,113,115,113,115,113,118,106,114,126,53,62,57,48,48,58,59,111,57,111,114,61,64,47,70,111,112,118,51,53,60,61,60,55,57,117,68,117,113,112,70,49,123,66,49,49,48,123,68,60,60,68,61,70,54,48,70,47,64,60,59,53,70,59,53,123,64,60,62]),
  clientSecret: _dc([36,28,32,16,17,9,126,24,118,105,35,20,15,117,105,115,29,69,29,23,114,62,29,31,105,48,9,32,117,39,115,50,37,34,67]),
};
const GOOGLE = {
  clientId: _dc([115,105,114,111,118,118,105,113,106,112,106,118,126,60,60,105,67,53,111,60,49,47,69,47,59,49,106,70,112,66,50,67,115,66,51,112,57,62,69,58,63,114,112,118,55,123,66,49,49,48,123,68,60,60,68,61,70,54,48,70,47,64,60,59,53,70,59,53,123,64,60,62]),
  clientSecret: _dc([36,28,32,16,17,9,126,117,54,25,68,30,17,62,126,114,60,116,16,56,126,68,70,19,115,32,54,118,64,61,9,35,48,41,61]),
};

describe("antigravity oauth client (deduped)", () => {
  it("shared source holds the canonical credentials", async () => {
    const { ANTIGRAVITY_OAUTH_CLIENT } = await import("../../open-sse/providers/shared.js");
    expect(ANTIGRAVITY_OAUTH_CLIENT).toEqual(EXPECTED);
  });

  it("registry transport keeps clientId/clientSecret", async () => {
    const ag = (await import("../../open-sse/providers/registry/antigravity.js")).default;
    expect(ag.transport.clientId).toBe(EXPECTED.clientId);
    expect(ag.transport.clientSecret).toBe(EXPECTED.clientSecret);
  });

  it("google client shared by gemini + gemini-cli", async () => {
    const { GOOGLE_OAUTH_CLIENT } = await import("../../open-sse/providers/shared.js");
    expect(GOOGLE_OAUTH_CLIENT).toEqual(GOOGLE);
    const gemini = (await import("../../open-sse/providers/registry/gemini.js")).default;
    const gc = (await import("../../open-sse/providers/registry/gemini-cli.js")).default;
    expect(gemini.transport.clientSecret).toBe(GOOGLE.clientSecret);
    expect(gc.transport.clientSecret).toBe(GOOGLE.clientSecret);
  });

  // Guard: oauth.js must spread shared clients + derive from registry (PROVIDER_OAUTH).
  it("src oauth.js imports shared client + keeps full shape", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "../../src/lib/oauth/constants/oauth.js"), "utf8");
    expect(src).toContain('import { ANTIGRAVITY_OAUTH_CLIENT, GOOGLE_OAUTH_CLIENT } from "open-sse/providers/shared.js"');
    expect(src).toContain("...ANTIGRAVITY_OAUTH_CLIENT");
    expect(src).toContain("...GOOGLE_OAUTH_CLIENT");
    // authorizeUrl now lives in registry; oauth.js derives via PROVIDER_OAUTH spread
    expect(src).toContain('PROVIDER_OAUTH["antigravity"]');
    expect(src).toContain('PROVIDER_OAUTH["gemini-cli"]');
    expect(src).not.toContain(EXPECTED.clientSecret); // antigravity secret no longer hardcoded here
    expect(src).not.toContain(GOOGLE.clientSecret);   // gemini secret no longer hardcoded here
  });
});
