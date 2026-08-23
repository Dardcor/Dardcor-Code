export default {
  id: "github",
  priority: 40,
  alias: "gh",
  uiAlias: "gh",
  display: {
    name: "GitHub Copilot",
    icon: "code",
    color: "#333333",
    website: "https://github.com/features/copilot",
    notice: {
      signupUrl: "https://github.com/features/copilot",
    },
    deprecated: true,
    deprecationNotice: "RISK_NOTICE",
  },
  category: "oauth",
  transport: {
    baseUrl: "https://api.githubcopilot.com/chat/completions",
    responsesUrl: "https://api.githubcopilot.com/responses",
    messagesUrl: "https://api.githubcopilot.com/v1/messages",
    headers: {
      "copilot-integration-id": "vscode-chat",
      "editor-version": "vscode/1.110.0",
      "editor-plugin-version": "copilot-chat/0.38.0",
      "user-agent": "GitHubCopilotChat/0.38.0",
      "openai-intent": "conversation-panel",
      "x-github-api-version": "2025-04-01",
      "x-vscode-user-agent-library-version": "electron-fetch",
      "X-Initiator": "user",
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    copilot: {
      vscodeVersion: "1.110.0",
      chatVersion: "0.38.0",
      userAgent: "GitHubCopilotChat/0.38.0",
      apiVersion: "2025-04-01",
    },
    usage: {
      url: "https://api.github.com/copilot_internal/user",
    },
  },
  models: [{
  id: "gpt-5.2",
  name: "GPT-5.2"
}, {
  id: "gpt-5.2-codex",
  name: "GPT-5.2 Codex"
}, {
  id: "gpt-5.3-codex",
  name: "GPT-5.3 Codex"
}, {
  id: "gpt-5.4",
  name: "GPT-5.4"
}, {
  id: "gpt-5.4-mini",
  name: "GPT-5.4 Mini"
},
// Note: routing to Copilot's Anthropic-native /v1/messages shim (see
// executors/github.js) is decided by model-NAME pattern at request time, not by
// a static targetFormat field here — Copilot's live model catalog (see
// services/copilotModels.js) regularly exposes claude-* models this static list
// hasn't caught up with yet (e.g. claude-opus-4.8), and a static per-entry
// targetFormat would silently miss those while also double-translating requests
// for models that ARE listed here (chatCore.js would pre-translate to Claude
// shape, then the executor would translate again). Keep these as plain entries.
{
  id: "claude-haiku-4.5",
  name: "Claude Haiku 4.5"
}, {
  id: "claude-opus-4.5",
  name: "Claude Opus 4.5"
}, {
  id: "claude-sonnet-4.5",
  name: "Claude Sonnet 4.5"
}, {
  id: "claude-sonnet-4.6",
  name: "Claude Sonnet 4.6"
}, {
  id: "claude-opus-4.6",
  name: "Claude Opus 4.6"
}, {
  id: "claude-opus-4.7",
  name: "Claude Opus 4.7"
}, {
  id: "gemini-2.5-pro",
  name: "Gemini 2.5 Pro"
}, {
  id: "gemini-3-flash-preview",
  name: "Gemini 3 Flash"
}, {
  id: "gemini-3.1-pro-preview",
  name: "Gemini 3.1 Pro"
}, {
  id: "grok-code-fast-1",
  name: "Grok Code Fast 1"
}, {
  id: "oswe-vscode-prime",
  name: "Raptor Mini"
}, {
  id: "goldeneye-free-auto",
  name: "GoldenEye"
}, {
  id: "text-embedding-3-small",
  name: "Text Embedding 3 Small (GitHub)",
  kind: "embedding"
}, {
  id: "text-embedding-3-large",
  name: "Text Embedding 3 Large (GitHub)",
  kind: "embedding"
}, {
  "id": "claude-fable-5",
  "name": "Claude Fable 5",
  "targetFormat": "claude",
  "contextLength": 1000000,
  "maxOutputTokens": 64000
}, {
  "id": "claude-opus-5",
  "name": "Claude Opus 5",
  "targetFormat": "claude",
  "contextLength": 1000000,
  "maxOutputTokens": 64000,
  "unsupportedParams": ["temperature", "top_p", "top_k"]
}, {
  "id": "claude-opus-4.8-fast",
  "name": "Claude Opus 4.8 (fast mode)",
  "targetFormat": "claude",
  "contextLength": 1000000,
  "maxOutputTokens": 64000,
  "unsupportedParams": ["temperature", "top_p", "top_k"]
}, {
  "id": "claude-opus-4.8",
  "name": "Claude Opus 4.8",
  "targetFormat": "claude",
  "contextLength": 1000000,
  "maxOutputTokens": 64000,
  "unsupportedParams": ["temperature", "top_p", "top_k"]
}, {
  "id": "claude-sonnet-5",
  "name": "Claude Sonnet 5",
  "targetFormat": "claude",
  "contextLength": 1000000,
  "maxOutputTokens": 64000
}, {
  "id": "gemini-3.5-flash",
  "name": "Gemini 3.5 Flash",
  "contextLength": 1000000,
  "maxOutputTokens": 64000
}, {
  "id": "gpt-5.6-sol",
  "name": "GPT-5.6 Sol",
  "maxOutputTokens": 128000
}, {
  "id": "gpt-5.6-terra",
  "name": "GPT-5.6 Terra",
  "maxOutputTokens": 128000
}, {
  "id": "gpt-5.6-luna",
  "name": "GPT-5.6 Luna",
  "maxOutputTokens": 128000
}, {
  "id": "gpt-5.5",
  "name": "GPT-5.5",
  "targetFormat": "openai-responses",
  "toolCalling": true,
  "supportsReasoning": true,
  "supportsVision": true,
  "supportsXHighEffort": true,
  "contextLength": 1050000,
  "maxOutputTokens": 128000
}, {
  "id": "gpt-5-mini",
  "name": "GPT-5 mini",
  "targetFormat": "openai-responses",
  "contextLength": 264000,
  "maxOutputTokens": 64000
}, {
  "id": "gpt-4o-2024-11-20",
  "name": "GPT-4o",
  "contextLength": 128000,
  "maxOutputTokens": 16384
}, {
  "id": "gpt-4o-mini",
  "name": "GPT-4o mini",
  "contextLength": 128000,
  "maxOutputTokens": 4096
}, {
  "id": "gpt-4-0125-preview",
  "name": "GPT 4 Turbo",
  "contextLength": 128000,
  "maxOutputTokens": 4096
}, {
  "id": "kimi-k2.7-code",
  "name": "Kimi K2.7 Code",
  "contextLength": 256000,
  "maxOutputTokens": 32000
}, {
  "id": "mai-code-1-flash",
  "name": "MAI-Code-1-Flash",
  "targetFormat": "openai-responses",
  "contextLength": 256000,
  "maxOutputTokens": 128000
}],
  serviceKinds: ["llm","embedding"],
  embeddingConfig: { baseUrl: "https://models.github.ai/inference/embeddings", authType: "apikey", authHeader: "bearer" },
  oauth: {
    clientId: "Iv1.b507a08c87ecfe98",
    authorizeUrl: "https://github.com/login/oauth/authorize",
    deviceCodeUrl: "https://github.com/login/device/code",
    tokenUrl: "https://github.com/login/oauth/access_token",
    userInfoUrl: "https://api.github.com/user",
    scopes: "read:user",
    apiVersion: "2022-11-28",
    copilotTokenUrl: "https://api.github.com/copilot_internal/v2/token",
    userAgent: "GitHubCopilotChat/0.26.7",
    editorVersion: "vscode/1.85.0",
    editorPluginVersion: "copilot-chat/0.26.7",
  },
  features: {
    usage: true,
  },
};
