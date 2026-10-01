import { describe, it, expect } from "vitest";
import {
  resolvePrivacyFlags,
  privacyProviderBlock,
  computeEffectivePrivacyFlags,
  isLocalConnection,
} from "@/lib/privacy/privacyMode.js";

const USER_ON = {
  cacheL1Enabled: true,
  cacheL2Enabled: true,
  cacheL3Enabled: true,
  headroomEnabled: true,
  pxpipeEnabled: true,
};

describe("resolvePrivacyFlags", () => {
  it("defaults to normal mode", () => {
    expect(resolvePrivacyFlags({})).toEqual({
      cacheL1: true, cacheL2: true, cacheL3: true,
      bodyLogging: true, headroom: true, pxpipe: true,
      blockProviders: [],
    });
  });

  it("merges privacyBlockedProviders into blockProviders", () => {
    const flags = resolvePrivacyFlags({ privacyMode: "strict", privacyBlockedProviders: ["openai", "anthropic"] });
    expect(flags.blockProviders).toEqual(["openai", "anthropic"]);
  });
});

describe("privacyProviderBlock", () => {
  it("matches provider id case-insensitively", () => {
    const privacy = { blockProviders: ["OpenAI", "anthropic"] };
    expect(privacyProviderBlock("openai", privacy)).toBe(true);
    expect(privacyProviderBlock("anthropic", privacy)).toBe(true);
    expect(privacyProviderBlock("gemini", privacy)).toBe(false);
  });

  it("matches provider objects by id/name", () => {
    const privacy = { blockProviders: ["groq"] };
    expect(privacyProviderBlock({ id: "groq" }, privacy)).toBe(true);
    expect(privacyProviderBlock({ name: "groq" }, privacy)).toBe(true);
    expect(privacyProviderBlock({ id: "xai" }, privacy)).toBe(false);
  });

  it("returns false for empty/absent block lists", () => {
    expect(privacyProviderBlock("openai", { blockProviders: [] })).toBe(false);
    expect(privacyProviderBlock("openai", null)).toBe(false);
    expect(privacyProviderBlock(null, { blockProviders: ["x"] })).toBe(false);
  });
});

describe("computeEffectivePrivacyFlags", () => {
  it("normal mode: user toggles govern all flags", () => {
    const f = computeEffectivePrivacyFlags({ privacyMode: "normal", ...USER_ON });
    expect(f).toMatchObject({
      cacheL1Enabled: true, cacheL2Enabled: true, cacheL3Enabled: true,
      headroomEnabled: true, pxpipeEnabled: true, bodyLoggingEnabled: true,
    });
  });

  it("normal mode with default toggles: L1 on, L2/L3/headroom/pxpipe off", () => {
    const f = computeEffectivePrivacyFlags({ privacyMode: "normal" });
    expect(f).toMatchObject({
      cacheL1Enabled: true, cacheL2Enabled: false, cacheL3Enabled: false,
      headroomEnabled: false, pxpipeEnabled: false, bodyLoggingEnabled: true,
    });
  });

  it("private-cache: L1/L3 follow user toggles; L2 only when embedding model is local", () => {
    const remote = computeEffectivePrivacyFlags({
      privacyMode: "private-cache", ...USER_ON, semanticCacheModel: "text-embedding-3-small",
    });
    expect(remote).toMatchObject({
      cacheL1Enabled: true, cacheL3Enabled: true,
      cacheL2Enabled: false, // cloud embedding -> L2 forced off
      headroomEnabled: false, pxpipeEnabled: false, bodyLoggingEnabled: false,
    });

    const local = computeEffectivePrivacyFlags({
      privacyMode: "private-cache", ...USER_ON, semanticCacheModel: "ollama/nomic-embed",
    });
    expect(local.cacheL2Enabled).toBe(true);
  });

  it("private-cache without user L3 toggle keeps L3 off", () => {
    const f = computeEffectivePrivacyFlags({
      privacyMode: "private-cache", cacheL1Enabled: true, cacheL3Enabled: false,
      semanticCacheModel: "ollama/nomic-embed",
    });
    expect(f.cacheL1Enabled).toBe(true);
    expect(f.cacheL3Enabled).toBe(false);
  });

  it("private-no-cache / strict / local-only disable all caches and offloads", () => {
    for (const mode of ["private-no-cache", "strict", "local-only"]) {
      const f = computeEffectivePrivacyFlags({ privacyMode: mode, ...USER_ON, semanticCacheModel: "ollama/nomic-embed" });
      expect(f).toMatchObject({
        cacheL1Enabled: false, cacheL2Enabled: false, cacheL3Enabled: false,
        headroomEnabled: false, pxpipeEnabled: false, bodyLoggingEnabled: false,
      });
    }
  });

  it("exposes mode and merged blockProviders", () => {
    const f = computeEffectivePrivacyFlags({ privacyMode: "local-only", privacyBlockedProviders: ["x"] });
    expect(f.mode).toBe("local-only");
    expect(f.blockProviders).toEqual(["x"]);
  });
});

describe("isLocalConnection with providerSpecificData.baseUrl", () => {
  it("accepts ollama-local style baseUrl in providerSpecificData", () => {
    expect(isLocalConnection({ providerSpecificData: { baseUrl: "http://localhost:11434" } })).toBe(true);
    expect(isLocalConnection({ providerSpecificData: { baseUrl: "http://192.168.1.10:8080" } })).toBe(true);
  });

  it("rejects remote baseUrl in providerSpecificData", () => {
    expect(isLocalConnection({ providerSpecificData: { baseUrl: "https://api.openai.com" } })).toBe(false);
  });

  it("prefers top-level baseUrl when both are present", () => {
    expect(isLocalConnection({ baseUrl: "https://remote.example.com", providerSpecificData: { baseUrl: "http://localhost:1" } })).toBe(false);
  });
});
