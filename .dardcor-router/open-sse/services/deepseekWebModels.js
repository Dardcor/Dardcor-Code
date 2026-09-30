import { getModelsByProviderId } from "../config/providerModels.js";

const DEFAULT_MODELS = [
  { id: "deepseek-chat", name: "DeepSeek-V3 (Instant)", upstreamModelId: "deepseek-chat" },
  { id: "deepseek-reasoner", name: "DeepSeek-R1 (DeepThink)", upstreamModelId: "deepseek-reasoner" },
  { id: "deepseek-v3", name: "DeepSeek-V3", upstreamModelId: "deepseek-chat" },
  { id: "deepseek-r1", name: "DeepSeek-R1", upstreamModelId: "deepseek-reasoner" },
  { id: "auto", name: "DeepSeek Auto", upstreamModelId: "deepseek-chat" },
];

export async function resolveDeepseekWebModels(credentials, options = {}) {
  const token = credentials?.accessToken || credentials?.apiKey;
  const staticModels = getModelsByProviderId("deepseek-web");
  const baseModels = staticModels.length > 0 ? staticModels : DEFAULT_MODELS;

  if (!token) {
    return {
      models: baseModels,
      warning: "No active token found; displaying default verified model catalog.",
    };
  }

  try {
    const probeRes = await fetch("https://chat.deepseek.com/api/v0/users/current", {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Authorization": `Bearer ${token}`,
        "Origin": "https://chat.deepseek.com",
        "Referer": "https://chat.deepseek.com/",
        "x-app-version": "20241129.1",
      },
      signal: AbortSignal.timeout(4000),
    });

    if (probeRes.ok) {
      const data = await probeRes.json();
      if (data?.code === 0 && data?.data) {
        options?.log?.info?.("DSW", `DeepSeek Web account verified: ${data.data.email || data.data.name || "Active"}`);
      }
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
