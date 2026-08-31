/**
 * Privacy enforcement across non-chat modality handlers.
 *
 * Covers:
 *  - checkPrivacy() shared helper: block vs skip vs bail contract
 *  - provider blocking (strict / local-only blocked list) on image, embeddings, TTS
 *  - local-only remote-account skipping (no markAccountUnavailable, 503 when
 *    no local account remains, no infinite loop on virtual noAuth creds)
 *  - local-only passing through to a local (self-hosted) connection
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkPrivacy } from "@/lib/privacy/privacyMode.js";

const authMocks = vi.hoisted(() => ({
  getProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(async () => ({ shouldFallback: true, cooldownMs: 0 })),
  clearAccountError: vi.fn(async () => {}),
  extractApiKey: vi.fn(() => null),
  isValidApiKey: vi.fn(async () => true),
}));
const modelMocks = vi.hoisted(() => ({
  getModelInfo: vi.fn(),
  getComboModels: vi.fn(async () => null),
}));
const tokenMocks = vi.hoisted(() => ({
  checkAndRefreshToken: vi.fn(async (_p, creds) => creds),
  updateProviderCredentials: vi.fn(async () => {}),
}));
const localDbMocks = vi.hoisted(() => ({
  getSettings: vi.fn(async () => ({ requireApiKey: false, privacyMode: "normal" })),
  getCombos: vi.fn(async () => []),
}));
const usageMocks = vi.hoisted(() => ({
  saveRequestUsage: vi.fn(async () => {}),
}));
const imageCore = vi.hoisted(() => ({ handleImageGenerationCore: vi.fn() }));
const embedCore = vi.hoisted(() => ({ handleEmbeddingsCore: vi.fn() }));
const ttsCore = vi.hoisted(() => ({ handleTtsCore: vi.fn() }));

vi.mock("@/sse/services/auth.js", () => authMocks);
vi.mock("@/sse/services/model.js", () => modelMocks);
vi.mock("@/sse/services/tokenRefresh.js", () => tokenMocks);
vi.mock("@/lib/localDb", () => localDbMocks);
vi.mock("@/lib/usageDb.js", () => usageMocks);
vi.mock("@/sse/utils/logger.js", () => ({
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), request: vi.fn(),
  maskKey: vi.fn((k) => "***"),
}));
vi.mock("open-sse/handlers/imageGenerationCore.js", () => imageCore);
vi.mock("open-sse/handlers/embeddingsCore.js", () => embedCore);
vi.mock("open-sse/handlers/ttsCore.js", () => ttsCore);

import { handleImageGeneration } from "@/sse/handlers/imageGeneration.js";
import { handleEmbeddings } from "@/sse/handlers/embeddings.js";
import { handleTts } from "@/sse/handlers/tts.js";

const okResponse = new Response(JSON.stringify({ ok: true }), { status: 200 });
const remoteAccount = (overrides = {}) => ({ connectionId: "conn-remote", accessToken: "tok", ...overrides });
const localAccount = (overrides = {}) => ({ connectionId: "conn-local", baseUrl: "http://localhost:11434", accessToken: "tok", ...overrides });

const jsonRequest = (url, body) =>
  new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => {
  authMocks.getProviderCredentials.mockReset();
  authMocks.markAccountUnavailable.mockClear();
  authMocks.clearAccountError.mockClear();
  modelMocks.getModelInfo.mockReset();
  imageCore.handleImageGenerationCore.mockReset().mockResolvedValue({ success: true, response: okResponse });
  embedCore.handleEmbeddingsCore.mockReset().mockResolvedValue({ success: true, response: okResponse });
  ttsCore.handleTtsCore.mockReset().mockResolvedValue({ success: true, response: okResponse });
});

function withSettings(overrides) {
  localDbMocks.getSettings.mockResolvedValue({ requireApiKey: false, privacyMode: "normal", ...overrides });
}

describe("checkPrivacy helper", () => {
  it("returns null in normal mode regardless of blocked list or credentials", () => {
    expect(checkPrivacy({ provider: "openai", settings: { privacyMode: "normal", privacyBlockedProviders: ["openai"] } })).toBeNull();
    expect(checkPrivacy({ provider: "openai", credentials: remoteAccount(), settings: { privacyMode: "normal" } })).toBeNull();
  });

  it("returns null for private-cache (blocked list only enforced in strict/local-only)", () => {
    expect(checkPrivacy({ provider: "openai", settings: { privacyMode: "private-cache", privacyBlockedProviders: ["openai"] } })).toBeNull();
  });

  it("blocks a provider on the strict blocked list with a 403 before credentials", () => {
    const r = checkPrivacy({ provider: "openai", settings: { privacyMode: "strict", privacyBlockedProviders: ["openai"] } });
    expect(r.block).toBe(true);
    expect(r.status).toBe(403);
    expect(r.message).toContain("blocked by privacy settings");
  });

  it("blocks a provider on the local-only blocked list too", () => {
    const r = checkPrivacy({ provider: "anthropic", settings: { privacyMode: "local-only", privacyBlockedProviders: ["anthropic"] } });
    expect(r.block).toBe(true);
    expect(r.status).toBe(403);
  });

  it("matches provider case-insensitively", () => {
    const r = checkPrivacy({ provider: "openai", settings: { privacyMode: "strict", privacyBlockedProviders: ["OpenAI"] } });
    expect(r.block).toBe(true);
  });

  it("skips remote accounts under local-only without marking them blocked", () => {
    const r = checkPrivacy({ provider: "openai", credentials: remoteAccount(), settings: { privacyMode: "local-only" } });
    expect(r.skip).toBe(true);
    expect(r.bail).toBe(false);
    expect(r.status).toBe(503);
  });

  it("bails (no exclude possible) when a remote account has no connectionId", () => {
    const r = checkPrivacy({ provider: "openai", credentials: remoteAccount({ connectionId: undefined }), settings: { privacyMode: "local-only" } });
    expect(r.skip).toBe(true);
    expect(r.bail).toBe(true);
  });

  it("allows local (self-hosted) connections under local-only", () => {
    expect(checkPrivacy({ provider: "openai", credentials: localAccount(), settings: { privacyMode: "local-only" } })).toBeNull();
  });

  it("returns null when strict but provider not on blocked list", () => {
    expect(checkPrivacy({ provider: "gemini", settings: { privacyMode: "strict", privacyBlockedProviders: ["openai"] } })).toBeNull();
  });
});

describe("handleImageGeneration privacy", () => {
  const req = () => jsonRequest("http://localhost/v1/images/generations", { model: "openai/dall-e-3", prompt: "a cat" });

  beforeEach(() => {
    modelMocks.getModelInfo.mockResolvedValue({ provider: "openai", model: "dall-e-3" });
  });

  it("returns 403 for a blocked provider before touching credentials or the core", async () => {
    withSettings({ privacyMode: "strict", privacyBlockedProviders: ["openai"] });
    const res = await handleImageGeneration(req());
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("blocked by privacy settings");
    expect(authMocks.getProviderCredentials).not.toHaveBeenCalled();
    expect(imageCore.handleImageGenerationCore).not.toHaveBeenCalled();
  });

  it("returns 403 for a blocked provider under local-only too", async () => {
    withSettings({ privacyMode: "local-only", privacyBlockedProviders: ["openai"] });
    const res = await handleImageGeneration(req());
    expect(res.status).toBe(403);
    expect(imageCore.handleImageGenerationCore).not.toHaveBeenCalled();
  });

  it("normal mode ignores the blocked list (privacy UI never disables connections)", async () => {
    withSettings({ privacyMode: "normal", privacyBlockedProviders: ["openai"] });
    authMocks.getProviderCredentials.mockResolvedValueOnce(remoteAccount());
    const res = await handleImageGeneration(req());
    expect(res.status).toBe(200);
    expect(imageCore.handleImageGenerationCore).toHaveBeenCalledTimes(1);
  });

  it("local-only skips remote accounts without marking unavailable and 503s when none remain", async () => {
    withSettings({ privacyMode: "local-only" });
    authMocks.getProviderCredentials.mockResolvedValueOnce(remoteAccount()).mockResolvedValueOnce(null);
    const res = await handleImageGeneration(req());
    expect(res.status).toBe(503);
    expect(await res.text()).toContain("local-only");
    expect(authMocks.markAccountUnavailable).not.toHaveBeenCalled();
    expect(imageCore.handleImageGenerationCore).not.toHaveBeenCalled();
  });

  it("local-only bails immediately on virtual noAuth credentials (no connectionId) — no infinite loop", async () => {
    withSettings({ privacyMode: "local-only" });
    authMocks.getProviderCredentials.mockResolvedValueOnce(remoteAccount({ connectionId: undefined, connectionName: "Public" }));
    const res = await handleImageGeneration(req());
    expect(res.status).toBe(503);
    expect(authMocks.getProviderCredentials).toHaveBeenCalledTimes(1);
    expect(imageCore.handleImageGenerationCore).not.toHaveBeenCalled();
  });

  it("local-only routes through to a local self-hosted connection and forwards privacyMode", async () => {
    withSettings({ privacyMode: "local-only" });
    authMocks.getProviderCredentials.mockResolvedValueOnce(localAccount());
    const res = await handleImageGeneration(req());
    expect(res.status).toBe(200);
    expect(imageCore.handleImageGenerationCore).toHaveBeenCalledWith(
      expect.objectContaining({ privacyMode: "local-only" })
    );
  });
});

describe("handleEmbeddings privacy", () => {
  const req = () => jsonRequest("http://localhost/v1/embeddings", { model: "openai/text-embedding-3-small", input: "hello" });

  beforeEach(() => {
    modelMocks.getModelInfo.mockResolvedValue({ provider: "openai", model: "text-embedding-3-small" });
  });

  it("returns 403 for a blocked provider without calling the core", async () => {
    withSettings({ privacyMode: "strict", privacyBlockedProviders: ["openai"] });
    const res = await handleEmbeddings(req());
    expect(res.status).toBe(403);
    expect(embedCore.handleEmbeddingsCore).not.toHaveBeenCalled();
  });

  it("local-only skips remote accounts and 503s when none remain", async () => {
    withSettings({ privacyMode: "local-only" });
    authMocks.getProviderCredentials.mockResolvedValueOnce(remoteAccount()).mockResolvedValueOnce(null);
    const res = await handleEmbeddings(req());
    expect(res.status).toBe(503);
    expect(await res.text()).toContain("local-only");
    expect(authMocks.markAccountUnavailable).not.toHaveBeenCalled();
  });

  it("local-only routes through to a local connection", async () => {
    withSettings({ privacyMode: "local-only" });
    authMocks.getProviderCredentials.mockResolvedValueOnce(localAccount());
    const res = await handleEmbeddings(req());
    expect(res.status).toBe(200);
    expect(embedCore.handleEmbeddingsCore).toHaveBeenCalledTimes(1);
  });
});

describe("handleTts privacy", () => {
  const req = () => jsonRequest("http://localhost/v1/audio/speech", { model: "openai/gpt-4o-mini-tts", input: "hello" });

  beforeEach(() => {
    modelMocks.getModelInfo.mockResolvedValue({ provider: "openai", model: "gpt-4o-mini-tts" });
  });

  it("returns 403 for a blocked provider without calling the core", async () => {
    withSettings({ privacyMode: "strict", privacyBlockedProviders: ["openai"] });
    const res = await handleTts(req());
    expect(res.status).toBe(403);
    expect(ttsCore.handleTtsCore).not.toHaveBeenCalled();
  });

  it("local-only skips remote accounts and 503s when none remain", async () => {
    withSettings({ privacyMode: "local-only" });
    authMocks.getProviderCredentials.mockResolvedValueOnce(remoteAccount()).mockResolvedValueOnce(null);
    const res = await handleTts(req());
    expect(res.status).toBe(503);
    expect(await res.text()).toContain("local-only");
    expect(authMocks.markAccountUnavailable).not.toHaveBeenCalled();
  });

  it("local-only routes through to a local connection", async () => {
    withSettings({ privacyMode: "local-only" });
    authMocks.getProviderCredentials.mockResolvedValueOnce(localAccount());
    const res = await handleTts(req());
    expect(res.status).toBe(200);
    expect(ttsCore.handleTtsCore).toHaveBeenCalledTimes(1);
  });
});
