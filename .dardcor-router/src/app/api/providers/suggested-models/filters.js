const KNOWN_FREE_OPENCODE_MODELS = ["big-pickle"];

const DEAD_OR_NON_CHAT_FREE_OPENCODE_MODELS = new Set([
  "jev-1.13",
  "jev-1.13-free",
  "deepseek-v4-flash-free",
  "exo-free",
  "ling-3.0-flash-fin-free",
  "mimo-v2.5-free",
  "union-alpha",
  "step-5-preview-free",
  "cat-jam-free",
  "longcat-2.5-preview-free",
  "space-bunny-free",
  "muse-spark-1.2-contributor-free",
  "muse-spark-1.3-contributor-free",
]);

export const FILTERS = {
  "openrouter-free": (models) =>
    models
      .filter(
        (m) =>
          m.pricing?.prompt === "0" &&
          m.pricing?.completion === "0" &&
          m.context_length >= 200000
      )
      .map((m) => ({ id: m.id, name: m.id, contextLength: m.context_length }))
      .sort((a, b) => b.contextLength - a.contextLength),

  "opencode-free": (models) =>
    models
      .filter(
        (m) =>
          (m.id?.endsWith("-free") || KNOWN_FREE_OPENCODE_MODELS.includes(m.id)) &&
          !DEAD_OR_NON_CHAT_FREE_OPENCODE_MODELS.has(m.id)
      )
      .map((m) => ({ id: m.id, name: m.id })),

  "mimo-free": (models) =>
    (Array.isArray(models) ? models : [])
      .filter((m) => m.id?.startsWith("mimo") || m.name?.toLowerCase().includes("mimo"))
      .map((m) => ({ id: m.id, name: m.name || m.id })),

  "airforce-free": (models) =>
    (Array.isArray(models) ? models : [])
      .filter((m) => (m.tier === "free" || m.id?.endsWith(":free")) && m.supports_chat === true && (!m.media_type || m.media_type === "chat" || m.media_type === "text"))
      .map((m) => ({ id: m.id, name: m.name || m.id, contextLength: m.context_length }))
      .sort((a, b) => String(a.id).localeCompare(String(b.id))),
};
