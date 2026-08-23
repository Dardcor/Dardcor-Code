export default {
  id: "openrouter",
  priority: 10,
  hasFree: true,
  alias: "openrouter",
  display: {
    name: "OpenRouter",
    icon: "router",
    color: "#F97316",
    textIcon: "OR",
    website: "https://openrouter.ai",
    notice: {
      text: "Free tier: 27+ free models, no credit card needed, 200 req/day. After  0 credit: 1,000 req/day.",
      apiKeyUrl: "https://openrouter.ai/settings/keys",
    },
  },
  category: "freeTier",
  authType: "apikey",
  authModes: ["apikey"],
  transport: {
    baseUrl: "https://openrouter.ai/api/v1/chat/completions",
    thinkingFormat: "openai",
    headers: {
      "HTTP-Referer": "https://endpoint-proxy.local",
      "X-Title": "Endpoint Proxy",
    },
  },
  models: [{
  id: "openai/text-embedding-3-large",
  name: "OpenAI Text Embedding 3 Large",
  kind: "embedding"
}, {
  id: "openai/text-embedding-3-small",
  name: "OpenAI Text Embedding 3 Small",
  kind: "embedding"
}, {
  id: "openai/text-embedding-ada-002",
  name: "OpenAI Text Embedding Ada 002",
  kind: "embedding"
}, {
  id: "qwen/qwen3-embedding-8b",
  name: "Qwen3 Embedding 8B",
  kind: "embedding"
}, {
  id: "perplexity/pplx-embed-v1-4b",
  name: "Perplexity Embed V1 4B",
  kind: "embedding"
}, {
  id: "perplexity/pplx-embed-v1-0.6b",
  name: "Perplexity Embed V1 0.6B",
  kind: "embedding"
}, {
  id: "nvidia/llama-nemotron-embed-vl-1b-v2:free",
  name: "NVIDIA Nemotron Embed VL 1B V2 (Free)",
  kind: "embedding"
}, {
  id: "openai/gpt-4o-mini-tts",
  name: "GPT-4o Mini TTS",
  kind: "tts"
}, {
  id: "openai/tts-1-hd",
  name: "TTS-1 HD",
  kind: "tts"
}, {
  id: "openai/tts-1",
  name: "TTS-1",
  kind: "tts"
}, {
  id: "openai/dall-e-3",
  name: "DALL-E 3 (via OpenRouter)",
  params: ["size", "quality", "style", "response_format"],
  kind: "image"
}, {
  id: "openai/gpt-image-1",
  name: "GPT Image 1 (via OpenRouter)",
  params: ["n", "size", "quality", "response_format"],
  kind: "image"
}, {
  id: "google/imagen-3.0-generate-002",
  name: "Imagen 3 (via OpenRouter)",
  params: ["n", "size"],
  kind: "image"
}, {
  id: "black-forest-labs/FLUX.1-schnell",
  name: "FLUX.1 Schnell (via OpenRouter)",
  params: ["n", "size"],
  kind: "image"
},
  { id: "auto", name: "Auto (Best Available)" },
    { id: "openrouter/auto:free", name: "OpenRouter Auto (Free)", isFreeTier: true },
    { id: "anthropic/claude-3.7-sonnet", name: "Claude 3.7 Sonnet" },
    { id: "anthropic/claude-3.7-sonnet:thinking", name: "Claude 3.7 Sonnet (Thinking)" },
    { id: "anthropic/claude-3.5-sonnet", name: "Claude 3.5 Sonnet" },
    { id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash" },
    { id: "google/gemini-2.5-pro", name: "Gemini 2.5 Pro" },
    { id: "deepseek/deepseek-r1", name: "DeepSeek R1", supportsReasoning: true },
    { id: "deepseek/deepseek-r1:free", name: "DeepSeek R1 (Free)", supportsReasoning: true, isFreeTier: true },
    { id: "deepseek/deepseek-chat", name: "DeepSeek V3" },
    { id: "deepseek/deepseek-chat:free", name: "DeepSeek V3 (Free)", isFreeTier: true },
    { id: "meta-llama/llama-3.3-70b-instruct", name: "Llama 3.3 70B" },
    { id: "meta-llama/llama-3.3-70b-instruct:free", name: "Llama 3.3 70B (Free)", isFreeTier: true },
    { id: "qwen/qwen-2.5-coder-32b-instruct", name: "Qwen 2.5 Coder 32B" },
    { id: "qwen/qwen-2.5-coder-32b-instruct:free", name: "Qwen 2.5 Coder 32B (Free)", isFreeTier: true },
    { id: "openai/gpt-4o", name: "GPT-4o" },
    { id: "openai/gpt-4o-mini", name: "GPT-4o Mini" },
    { id: "openai/gpt-4o-mini:free", name: "GPT-4o Mini (Free)", isFreeTier: true },
    { id: "openai/o3-mini", name: "O3 Mini" },
  ],
  serviceKinds: ["llm","embedding","tts","imageToText"],
  ttsConfig: {
    baseUrl: "https://openrouter.ai/api/v1/chat/completions",
    defaultModel: "openai/gpt-4o-mini-tts",
    headers: {"HTTP-Referer":"https://endpoint-proxy.local","X-Title":"Endpoint Proxy"},
  },
  embeddingConfig: {
    baseUrl: "https://openrouter.ai/api/v1/embeddings",
    authType: "apikey",
    authHeader: "bearer",
    headers: {"HTTP-Referer":"https://endpoint-proxy.local","X-Title":"Endpoint Proxy"},
  },
  imageConfig: {
    baseUrl: "https://openrouter.ai/api/v1/images/generations",
    headers: {"HTTP-Referer":"https://endpoint-proxy.local","X-Title":"Endpoint Proxy"},
  },
  modelsFetcher: { url: "https://openrouter.ai/api/v1/models", type: "openrouter-free" },
  passthroughModels: true,
};
