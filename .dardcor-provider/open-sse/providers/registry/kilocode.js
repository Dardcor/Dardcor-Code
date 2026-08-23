export default {
  id: "kilocode",
  priority: 70,
  alias: "kc",
  uiAlias: "kc",
  display: {
    name: "Kilo Code",
    icon: "code",
    color: "#FF6B35",
    textIcon: "KC",
    website: "https://kilocode.ai",
    notice: {
      signupUrl: "https://kilocode.ai",
    },
  },
  category: "oauth",
  transport: {
    baseUrl: "https://api.kilo.ai/api/openrouter/chat/completions",
    headers: {},
    auth: {
      combined: true,
      header: "Authorization",
      scheme: "bearer",
      hooks: [
        "kilocodeOrg",
      ],
    },
  },
  models: [{
  id: "anthropic/claude-sonnet-4-20250514",
  name: "Claude Sonnet 4"
}, {
  id: "anthropic/claude-opus-4-20250514",
  name: "Claude Opus 4"
}, {
  id: "google/gemini-2.5-pro",
  name: "Gemini 2.5 Pro"
}, {
  id: "google/gemini-2.5-flash",
  name: "Gemini 2.5 Flash"
}, {
  id: "openai/gpt-4.1",
  name: "GPT-4.1"
}, {
  id: "openai/o3",
  name: "o3"
}, {
  id: "deepseek/deepseek-chat",
  name: "DeepSeek Chat"
}, {
  id: "deepseek/deepseek-reasoner",
  name: "DeepSeek Reasoner"
}, {
  "id": "openrouter/free",
  "name": "Free Models Router"
}, {
  "id": "qwen/qwen3.6-plus",
  "name": "Qwen3.6 Plus"
}, {
  "id": "qwen/qwen3.5-397b-a17b",
  "name": "Qwen3.5 397B A17B"
}, {
  "id": "openai/gpt-5.5",
  "name": "GPT-5.5"
}, {
  "id": "openai/gpt-5.4-mini",
  "name": "GPT-5.4 Mini"
}, {
  "id": "anthropic/claude-opus-4.7",
  "name": "Claude Opus 4.7"
}, {
  "id": "anthropic/claude-sonnet-4.6",
  "name": "Claude Sonnet 4.6"
}, {
  "id": "anthropic/claude-haiku-4.5",
  "name": "Claude Haiku 4.5"
}, {
  "id": "google/gemini-3.1-pro-preview",
  "name": "Gemini 3.1 Pro"
}, {
  "id": "google/gemini-3-flash-preview",
  "name": "Gemini 3 Flash"
}, {
  "id": "google/gemini-3.1-flash-lite",
  "name": "Gemini 3.1 Flash Lite"
}, {
  "id": "deepseek/deepseek-v4-pro",
  "name": "DeepSeek V4 Pro",
  "supportsReasoning": true
}, {
  "id": "deepseek/deepseek-v4-flash",
  "name": "DeepSeek V4 Flash",
  "supportsReasoning": true
}, {
  "id": "moonshotai/kimi-k2.6",
  "name": "Kimi K2.6"
}],
  // Kilo Code proxies the OpenRouter catalog (334 models at time of writing),
  // so the hardcoded list above is only a fallback. Surfacing the full catalog
  // requires a fetcher + passthroughModels, matching how openrouter.js is set up.
  // Without these, only the 8 hardcoded models appear in the combo model picker,
  // hiding dynamic models like cohere/north-mini-code:free and poolside/laguna-m.1:free.
  modelsFetcher: { url: "https://api.kilo.ai/api/gateway/models", type: "openrouter-free" },
  passthroughModels: true,
  oauth: {
    apiBaseUrl: "https://api.kilo.ai",
    initiateUrl: "https://api.kilo.ai/api/device-auth/codes",
    pollUrlBase: "https://api.kilo.ai/api/device-auth/codes",
  },
};
