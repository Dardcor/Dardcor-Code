export default {
  id: "opencode-go",
  priority: 210,
  alias: "opencode-go",
  aliases: [
    "ocg",
  ],
  uiAlias: "ocg",
  display: {
    name: "OpenCode Go",
    icon: "terminal",
    color: "#E87040",
    textIcon: "OC",
    website: "https://opencode.ai/auth",
    notice: {
      text: "OpenCode Go subscription: $5/mo (then  0/mo). Access to Kimi, GLM, Qwen, MiMo, MiniMax models.",
      apiKeyUrl: "https://opencode.ai/auth",
    },
  },
  category: "apikey",
  billingTier: "subscription",
  transport: {
    baseUrl: "https://opencode.ai/zen/go/v1/chat/completions",
    headers: {},
  },
  models: [{
  id: "glm-5.2",
  name: "GLM 5.2"
}, {
  id: "glm-5.1",
  name: "GLM 5.1"
}, {
  id: "kimi-k2.7-code",
  name: "Kimi K2.7 Code"
}, {
  id: "kimi-k2.6",
  name: "Kimi K2.6"
}, {
  id: "deepseek-v4-pro",
  name: "DeepSeek V4 Pro"
}, {
  id: "deepseek-v4-flash",
  name: "DeepSeek V4 Flash"
}, {
  id: "mimo-v2.5",
  name: "MiMo V2.5"
}, {
  id: "mimo-v2.5-pro",
  name: "MiMo V2.5 Pro"
}, {
  id: "minimax-m3",
  name: "MiniMax M3",
  targetFormat: "claude"
}, {
  id: "minimax-m2.7",
  name: "MiniMax M2.7",
  targetFormat: "claude"
}, {
  id: "minimax-m2.5",
  name: "MiniMax M2.5",
  targetFormat: "claude"
}, {
  id: "qwen3.7-max",
  name: "Qwen 3.7 Max",
  targetFormat: "claude"
}, {
  id: "qwen3.7-plus",
  name: "Qwen 3.7 Plus",
  targetFormat: "claude"
}, {
  id: "qwen3.6-plus",
  name: "Qwen 3.6 Plus",
  targetFormat: "claude"
}, {
  "id": "glm-5.2-high",
  "name": "GLM-5.2 (high effort)",
  "supportsReasoning": true
}, {
  "id": "glm-5.2-max",
  "name": "GLM-5.2 (max effort)",
  "supportsReasoning": true
}, {
  "id": "glm-5",
  "name": "GLM-5"
}, {
  "id": "kimi-k2.5",
  "name": "Kimi K2.5"
}, {
  "id": "kimi-k3",
  "name": "Kimi K3",
  "supportsReasoning": true
}, {
  "id": "kimi-k3-max",
  "name": "Kimi K3 (max effort)",
  "supportsReasoning": true
}, {
  "id": "mimo-v2.5-high",
  "name": "MiMo-V2.5 (high effort)",
  "supportsReasoning": true
}, {
  "id": "mimo-v2.5-max",
  "name": "MiMo-V2.5 (max effort)",
  "supportsReasoning": true
}, {
  "id": "qwen3.7-max-high",
  "name": "Qwen3.7 Max (high effort)",
  "targetFormat": "claude",
  "supportsVision": false,
  "supportsReasoning": true
}, {
  "id": "qwen3.7-max-max",
  "name": "Qwen3.7 Max (max effort)",
  "targetFormat": "claude",
  "supportsVision": false,
  "supportsReasoning": true
}, {
  "id": "qwen3.7-plus-high",
  "name": "Qwen3.7 Plus (high effort)",
  "targetFormat": "claude",
  "supportsVision": false,
  "supportsReasoning": true
}, {
  "id": "qwen3.7-plus-max",
  "name": "Qwen3.7 Plus (max effort)",
  "targetFormat": "claude",
  "supportsVision": false,
  "supportsReasoning": true
}, {
  "id": "qwen3.6-plus-high",
  "name": "Qwen3.6 Plus (high effort)",
  "targetFormat": "claude",
  "supportsVision": false,
  "supportsReasoning": true
}, {
  "id": "qwen3.6-plus-max",
  "name": "Qwen3.6 Plus (max effort)",
  "targetFormat": "claude",
  "supportsVision": false,
  "supportsReasoning": true
}, {
  "id": "qwen3.5-plus",
  "name": "Qwen3.5 Plus",
  "targetFormat": "claude",
  "supportsVision": false
}, {
  "id": "hy3",
  "name": "Hunyuan3",
  "contextLength": 256000,
  "supportsReasoning": true
}, {
  "id": "hy3-none",
  "name": "Hunyuan3 (none effort)",
  "contextLength": 256000,
  "supportsReasoning": true
}, {
  "id": "hy3-low",
  "name": "Hunyuan3 (low effort)",
  "contextLength": 256000,
  "supportsReasoning": true
}, {
  "id": "hy3-high",
  "name": "Hunyuan3 (high effort)",
  "contextLength": 256000,
  "supportsReasoning": true
}, {
  "id": "hy3-preview",
  "name": "Hunyuan3 Preview"
}, {
  "id": "grok-4.5",
  "name": "Grok 4.5",
  "supportsReasoning": true
}, {
  "id": "grok-4.5-low",
  "name": "Grok 4.5 (low effort)",
  "supportsReasoning": true
}, {
  "id": "grok-4.5-medium",
  "name": "Grok 4.5 (medium effort)",
  "supportsReasoning": true
}, {
  "id": "grok-4.5-high",
  "name": "Grok 4.5 (high effort)",
  "supportsReasoning": true
}, {
  "id": "deepseek-v4-pro-low",
  "name": "DeepSeek V4 Pro (low effort)",
  "supportsReasoning": true
}, {
  "id": "deepseek-v4-pro-medium",
  "name": "DeepSeek V4 Pro (medium effort)",
  "supportsReasoning": true
}, {
  "id": "deepseek-v4-pro-high",
  "name": "DeepSeek V4 Pro (high effort)",
  "supportsReasoning": true
}, {
  "id": "deepseek-v4-pro-max",
  "name": "DeepSeek V4 Pro (max effort)",
  "supportsReasoning": true
}, {
  "id": "deepseek-v4-flash-high",
  "name": "DeepSeek V4 Flash (high effort)",
  "supportsReasoning": true
}, {
  "id": "deepseek-v4-flash-max",
  "name": "DeepSeek V4 Flash (max effort)",
  "supportsReasoning": true
}],
};
