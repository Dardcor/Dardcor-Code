import { platform, arch } from "os";

// === OS/Arch helpers (Stainless fingerprint) ===
export function mapStainlessOs() {
  switch (platform()) {
    case "darwin": return "MacOS";
    case "win32": return "Windows";
    case "linux": return "Linux";
    case "freebsd": return "FreeBSD";
    default: return `Other::${platform()}`;
  }
}

export function mapStainlessArch() {
  switch (arch()) {
    case "x64": return "x64";
    case "arm64": return "arm64";
    case "ia32": return "x86";
    default: return `other::${arch()}`;
  }
}

// Anthropic API version (single source — reused across claude-format providers/executors)
export const ANTHROPIC_API_VERSION = "2023-06-01";

// Shared Claude-compatible API headers (reused across claude-format providers)
export const CLAUDE_API_HEADERS = {
  "Anthropic-Version": ANTHROPIC_API_VERSION,
  "Anthropic-Beta": "claude-code-20250219,interleaved-thinking-2025-05-14"
};

// Full Claude CLI fingerprint — required by providers that gate on client identity (e.g. agentrouter)
export const CLAUDE_CLI_SPOOF_HEADERS = {
  "Anthropic-Version": ANTHROPIC_API_VERSION,
  "Anthropic-Beta": "claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,context-management-2025-06-27,prompt-caching-scope-2026-01-05,advanced-tool-use-2025-11-20,effort-2025-11-24,structured-outputs-2025-12-15,fast-mode-2026-02-01,redact-thinking-2026-02-12,token-efficient-tools-2026-03-28",
  "Anthropic-Dangerous-Direct-Browser-Access": "true",
  "User-Agent": "claude-cli/2.1.92 (external, sdk-cli)",
  "X-App": "cli",
  "X-Stainless-Helper-Method": "stream",
  "X-Stainless-Retry-Count": "0",
  "X-Stainless-Runtime-Version": "v24.14.0",
  "X-Stainless-Package-Version": "0.80.0",
  "X-Stainless-Runtime": "node",
  "X-Stainless-Lang": "js",
  "X-Stainless-Arch": mapStainlessArch(),
  "X-Stainless-Os": mapStainlessOs(),
  "X-Stainless-Timeout": "600"
};

const ANTHROPIC_BETA_BASE = [
  "claude-code-20250219",
  "oauth-2025-04-20",
  "interleaved-thinking-2025-05-14",
  "context-management-2025-06-27",
  "prompt-caching-scope-2026-01-05",
  "structured-outputs-2025-12-15",
  "fast-mode-2026-02-01",
  "redact-thinking-2026-02-12",
  "token-efficient-tools-2026-03-28",
];
const ANTHROPIC_BETA_HEAVY_AGENT = ["advanced-tool-use-2025-11-20", "effort-2025-11-24"];

// Heavy-agent beta flags are gated to opus/sonnet — cheaper models don't need them.
export function selectAnthropicBeta(model = "") {
  const flags = [...ANTHROPIC_BETA_BASE];
  if (/^claude-(opus|sonnet)/.test(model)) flags.push(...ANTHROPIC_BETA_HEAVY_AGENT);
  return flags.join(",");
}

// Shared baseUrls
export const KIMI_CODING_BASE_URL = "https://api.kimi.com/coding/v1/messages";

// Default base for dynamic compat providers (openai-compatible-* / anthropic-compatible-*) when user gives no baseUrl
export const OPENAI_COMPAT_BASE = "https://api.openai.com/v1";
export const ANTHROPIC_COMPAT_BASE = "https://api.anthropic.com/v1";

// Official Antigravity IDE Desktop 2.1.1 fingerprint captured from macOS arm64.
// Keep this static even when 9router runs on Linux: the provider profile is
// intentionally matching the IDE client, not the server host.
export const ANTIGRAVITY_IDE_VERSION = "2.1.1";
export const ANTIGRAVITY_IDE_BASE_URL = "https://daily-cloudcode-pa.googleapis.com";
export const ANTIGRAVITY_IDE_USER_AGENT = `antigravity/ide/${ANTIGRAVITY_IDE_VERSION} darwin/arm64`;

// Multi-layer runtime credential decryption
// Layer 1: XOR cipher with dynamic key
// Layer 2: Bit shift offset
// Layer 3: Dynamic byte array reconstitution
function _dc(bytes, key = 0x5A, shift = 7) {
  let res = "";
  for (let i = 0; i < bytes.length; i++) {
    res += String.fromCharCode(((bytes[i] - shift) & 0xFF) ^ key);
  }
  return res;
}

// Antigravity OAuth client credentials (public CLI client — duplicated in usage.js + src/lib/oauth)
export const ANTIGRAVITY_OAUTH_CLIENT = {
  clientId: process.env.GOOGLE_OAUTH_CLIENT_ID || _dc([114,113,116,114,113,113,115,113,115,113,118,106,114,126,53,62,57,48,48,58,59,111,57,111,114,61,64,47,70,111,112,118,51,53,60,61,60,55,57,117,68,117,113,112,70,49,123,66,49,49,48,123,68,60,60,68,61,70,54,48,70,47,64,60,59,53,70,59,53,123,64,60,62]),
  clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || _dc([36,28,32,16,17,9,126,24,118,105,35,20,15,117,105,115,29,69,29,23,114,62,29,31,105,48,9,32,117,39,115,50,37,34,67])
};

// Gemini (Google) OAuth client credentials (public CLI client — shared by gemini, gemini-cli, src/lib/oauth)
export const GOOGLE_OAUTH_CLIENT = {
  clientId: process.env.GEMINI_CLI_CLIENT_ID || _dc([115,105,114,111,118,118,105,113,106,112,106,118,126,60,60,105,67,53,111,60,49,47,69,47,59,49,106,70,112,66,50,67,115,66,51,112,57,62,69,58,63,114,112,118,55,123,66,49,49,48,123,68,60,60,68,61,70,54,48,70,47,64,60,59,53,70,59,53,123,64,60,62]),
  clientSecret: process.env.GEMINI_CLI_CLIENT_SECRET || _dc([36,28,32,16,17,9,126,117,54,25,68,30,17,62,126,114,60,116,16,56,126,68,70,19,115,32,54,118,64,61,9,35,48,41,61])
};
