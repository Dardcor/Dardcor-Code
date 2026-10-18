export const FORMATS = {
  OPENAI: "openai",
  OPENAI_RESPONSES: "openai-responses",
  OPENAI_RESPONSE: "openai-response",
  CLAUDE: "claude",
  GEMINI: "gemini",
  GEMINI_CLI: "gemini-cli",
  VERTEX: "vertex",
  CODEX: "codex",
  ANTIGRAVITY: "antigravity",
  KIRO: "kiro",
  CURSOR: "cursor",
  OLLAMA: "ollama",
  COMMANDCODE: "commandcode"
};

export function detectFormatByEndpoint(pathname, body) {
  if (pathname.includes("/v1/responses")) return FORMATS.OPENAI_RESPONSES;

  if (pathname.includes("/v1/messages")) return FORMATS.CLAUDE;

  if (pathname.includes("/v1/chat/completions") && Array.isArray(body?.input)) {
    return FORMATS.OPENAI;
  }

  return null;
}

