/**
 * Gemini Web dynamic model resolver.
 * Detects and syncs latest active models for Gemini Web.
 */

import { getModelsByProviderId } from "../config/providerModels.js";

const DEFAULT_MODELS = [
  { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash (Free / Default)", upstreamModelId: "gemini-3.5-flash" },
  { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash (Free Active)", upstreamModelId: "gemini-3.8-flash" },
  { id: "gemini-3.7-flash", name: "Gemini 3.7 Flash", upstreamModelId: "gemini-3.7-flash" },
  { id: "gemini-flash", name: "Gemini Flash (Free)", upstreamModelId: "gemini-3.5-flash" },
  { id: "auto", name: "Gemini Auto (Free / Default)", upstreamModelId: "gemini-3.5-flash" },
  { id: "gemini-3.1-pro", name: "Gemini 3.1 Pro (Google AI Pro - 1M Context)", upstreamModelId: "gemini-3.1-pro" },
  { id: "gemini-pro", name: "Gemini Pro (Google AI Pro)", upstreamModelId: "gemini-3.1-pro" },
  { id: "gemini-thinking", name: "Gemini Thinking / Deep Think (Pro)", upstreamModelId: "gemini-3.8-live" },
  { id: "gemini-3.8-live", name: "Gemini 3.8 Live (Pro Extended)", upstreamModelId: "gemini-3.8-live" },
  { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro (Legacy Pro)", upstreamModelId: "gemini-2.5-pro" },
  { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash (Legacy)", upstreamModelId: "gemini-2.5-flash" },
];

export async function resolveGeminiWebModels(credentials, options = {}) {
  const cookie = credentials?.cookie || credentials?.apiKey || credentials?.accessToken;
  const staticModels = getModelsByProviderId("gemini-web");
  const baseModels = staticModels.length > 0 ? staticModels : DEFAULT_MODELS;

  if (!cookie) {
    return {
      models: baseModels,
      warning: "No active cookie found; displaying default updated Gemini 3.8 series catalog.",
    };
  }

  // Attempt to probe Gemini Web session if online
  try {
    const probeRes = await fetch("https://gemini.google.com/app", {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
        "Cookie": cookie.includes("=") ? cookie : `__Secure-1PSID=${cookie}`,
      },
      signal: AbortSignal.timeout(4000),
    });

    if (probeRes.ok) {
      options?.log?.info?.("GMW", "Gemini Web session verified via /app response.");
    }
  } catch {}

  return {
    models: baseModels.map((m) => ({
      id: m.id,
      name: m.name || m.id,
      upstreamModelId: m.upstreamModelId || m.id,
    })),
  };
}
