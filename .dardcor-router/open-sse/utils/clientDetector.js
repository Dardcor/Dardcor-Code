
const NATIVE_PAIRS = {
  "claude": ["claude", "anthropic"],
  "gemini-cli": ["gemini-cli"],
  "antigravity": ["antigravity"],
  "codex": ["codex"],
};

export function detectClientTool(headers = {}, body = {}) {
  const ua = (headers["user-agent"] || "").toLowerCase();
  const xApp = (headers["x-app"] || "").toLowerCase();
  const originator = (headers["originator"] || "").toLowerCase();

  if (body.userAgent === "antigravity") return "antigravity";

  if (ua.includes("claude-cli") || ua.includes("claude-code") || xApp === "cli") return "claude";

  if (ua.includes("gemini-cli")) return "gemini-cli";

  if (ua.includes("codex-tui") || ua.includes("codex-cli") || ua.includes("codex_cli_rs") ||
      ua.includes("codex desktop") || originator.startsWith("codex_")) return "codex";

  if (ua.includes("deepseek-tui")) return "deepseek-tui";

  return null;
}

export function isNativePassthrough(clientTool, provider) {
  if (!clientTool) return false;
  const nativeProviders = NATIVE_PAIRS[clientTool];
  if (!nativeProviders) return false;
  const normalizedProvider = provider.startsWith("anthropic-compatible")
    ? "anthropic"
    : provider;
  return nativeProviders.includes(normalizedProvider);
}
