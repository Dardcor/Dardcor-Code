export default {
  id: "cline",
  priority: 80,
  alias: "cl",
  uiAlias: "cl",
  display: {
    name: "Cline",
    icon: "smart_toy",
    color: "#5B9BD5",
    textIcon: "CL",
    website: "https://cline.bot",
    notice: {
      signupUrl: "https://cline.bot",
    },
  },
  category: "oauth",
  transport: {
    baseUrl: "https://api.cline.bot/api/v1/chat/completions",
    headers: {
      "HTTP-Referer": "https://cline.bot",
      "X-Title": "Cline",
    },
    tokenUrl: "https://api.cline.bot/api/v1/auth/token",
    refreshUrl: "https://api.cline.bot/api/v1/auth/refresh",
    auth: {
      combined: true,
      header: "Authorization",
      scheme: "bearer",
      hooks: [
        "clineHeaders",
      ],
    },
  },
  models: [{
  id: "anthropic/claude-opus-4.7",
  name: "Claude Opus 4.7"
}, {
  id: "anthropic/claude-sonnet-4.6",
  name: "Claude Sonnet 4.6"
}, {
  id: "anthropic/claude-opus-4.6",
  name: "Claude Opus 4.6"
}, {
  id: "openai/gpt-5.3-codex",
  name: "GPT-5.3 Codex"
}, {
  id: "openai/gpt-5.4",
  name: "GPT-5.4"
}, {
  id: "google/gemini-3.1-pro-preview",
  name: "Gemini 3.1 Pro Preview"
}, {
  id: "google/gemini-3.1-flash-lite-preview",
  name: "Gemini 3.1 Flash Lite Preview"
}, {
  id: "kwaipilot/kat-coder-pro",
  name: "KAT Coder Pro"
}, {
  "id": "zai/glm-5.2",
  "name": "GLM 5.2",
  "toolCalling": true,
  "supportsReasoning": true,
  "contextLength": 1040000,
  "maxInputTokens": 1040000,
  "maxOutputTokens": 128000
}, {
  "id": "x-ai/grok-4.5",
  "name": "Grok 4.5",
  "toolCalling": true,
  "supportsReasoning": true,
  "supportsVision": true,
  "contextLength": 500000,
  "maxInputTokens": 500000,
  "maxOutputTokens": 500000
}, {
  "id": "openai/gpt-5.6-sol",
  "name": "GPT-5.6 Sol",
  "toolCalling": true,
  "supportsReasoning": true,
  "supportsVision": true,
  "contextLength": 1050000,
  "maxInputTokens": 922000,
  "maxOutputTokens": 128000
}, {
  "id": "moonshotai/kimi-k3",
  "name": "Kimi K3",
  "toolCalling": true,
  "supportsReasoning": true,
  "supportsVision": true,
  "contextLength": 1048576,
  "maxInputTokens": 1048576,
  "maxOutputTokens": 1048576
}, {
  "id": "anthropic/claude-opus-4.8",
  "name": "Claude Opus 4.8",
  "toolCalling": true,
  "supportsReasoning": true,
  "supportsVision": true,
  "contextLength": 1000000,
  "maxInputTokens": 1000000,
  "maxOutputTokens": 128000
}, {
  "id": "openrouter/free",
  "name": "Free Models Router",
  "toolCalling": true,
  "supportsReasoning": true,
  "supportsVision": true,
  "contextLength": 200000,
  "maxInputTokens": 200000
}, {
  "id": "deepseek/deepseek-v4-flash",
  "name": "DeepSeek V4 Flash (Free)",
  "toolCalling": true,
  "supportsReasoning": true,
  "contextLength": 1048576,
  "maxInputTokens": 1048576,
  "maxOutputTokens": 65536
}, {
  "id": "tencent/hy3:free",
  "name": "Tencent Hy3 (Free)",
  "toolCalling": true,
  "supportsReasoning": true,
  "contextLength": 262144,
  "maxInputTokens": 262144,
  "maxOutputTokens": 262144
}, {
  "id": "stepfun/step-3.7-flash",
  "name": "Step 3.7 Flash (Free)",
  "toolCalling": true,
  "supportsReasoning": true,
  "supportsVision": true,
  "contextLength": 256000,
  "maxInputTokens": 256000,
  "maxOutputTokens": 256000
}, {
  "id": "poolside/laguna-m.1:free",
  "name": "Laguna M.1 (Free)",
  "toolCalling": true,
  "supportsReasoning": true,
  "contextLength": 262144,
  "maxInputTokens": 262144,
  "maxOutputTokens": 32768
}, {
  "id": "google/gemma-4-31b-it:free",
  "name": "Gemma 4 31B (Free)",
  "toolCalling": true,
  "supportsReasoning": true,
  "supportsVision": true,
  "contextLength": 262144,
  "maxInputTokens": 262144,
  "maxOutputTokens": 32768
}, {
  "id": "nvidia/nemotron-3-ultra-550b-a55b:free",
  "name": "Nemotron 3 Ultra (Free)",
  "toolCalling": true,
  "supportsReasoning": true,
  "contextLength": 1000000,
  "maxInputTokens": 1000000,
  "maxOutputTokens": 65536
}, {
  "id": "minimax/minimax-m3",
  "name": "MiniMax M3 (Free)",
  "toolCalling": true,
  "supportsReasoning": true,
  "supportsVision": true,
  "contextLength": 1048576,
  "maxInputTokens": 1048576,
  "maxOutputTokens": 65536
}],
  oauth: {
    appBaseUrl: "https://app.cline.bot",
    apiBaseUrl: "https://api.cline.bot",
    authorizeUrl: "https://api.cline.bot/api/v1/auth/authorize",
    tokenExchangeUrl: "https://api.cline.bot/api/v1/auth/token",
    refreshUrl: "https://api.cline.bot/api/v1/auth/refresh",
  },
};
