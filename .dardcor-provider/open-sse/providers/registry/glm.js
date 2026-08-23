import { CLAUDE_API_HEADERS } from "../shared.js";

export default {
  id: "glm",
  priority: 140,
  alias: "glm",
  display: {
    name: "GLM Coding",
    icon: "code",
    color: "#2563EB",
    textIcon: "GL",
    website: "https://open.bigmodel.cn",
    notice: {
      apiKeyUrl: "https://open.bigmodel.cn/usercenter/apikeys",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.z.ai/api/anthropic/v1/messages",
    format: "claude",
    urlSuffix: "?beta=true",
    headers: { ...CLAUDE_API_HEADERS },
    auth: {
      combined: true,
      header: "x-api-key",
      scheme: "raw",
    },
    usage: {
      url: "https://api.z.ai/api/monitor/usage/quota/limit",
    },
  },
  // Multi-endpoint: pick the transport matching client sourceFormat to skip translation.
  transports: [
    {
      format: "openai",
      baseUrl: "https://api.z.ai/api/coding/paas/v4/chat/completions",
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
    {
      format: "claude",
      baseUrl: "https://api.z.ai/api/anthropic/v1/messages",
      urlSuffix: "?beta=true",
      headers: { ...CLAUDE_API_HEADERS },
      auth: { combined: true, header: "x-api-key", scheme: "raw" },
    },
  ],
  hasFree: true,
  passthroughModels: true,
  models: [
    { id: "glm-5.3", name: "GLM 5.3", contextLength: 1000000, maxOutputTokens: 131072, toolCalling: true, supportsReasoning: true },
    { id: "glm-5.3-turbo", name: "GLM 5.3 Turbo", contextLength: 1000000, maxOutputTokens: 131072, toolCalling: true, supportsReasoning: true },
    { id: "glm-5.3-high", name: "GLM 5.3 High", contextLength: 1000000, maxOutputTokens: 131072, toolCalling: true, supportsReasoning: true },
    { id: "glm-5.3-max", name: "GLM 5.3 Max", contextLength: 1000000, maxOutputTokens: 131072, toolCalling: true, supportsReasoning: true },
    { id: "glm-5.3-coder", name: "GLM 5.3 Coder", contextLength: 1000000, maxOutputTokens: 131072, toolCalling: true, supportsReasoning: true },
    { id: "glm-5.2", name: "GLM 5.2" },
    { id: "glm-5.1", name: "GLM 5.1" },
    { id: "glm-5", name: "GLM 5" },
    { id: "glm-4.7", name: "GLM 4.7" }, {
  id: "glm-4.6v",
  name: "GLM 4.6V (Vision)"
}, {
  "id": "glm-5.2-high",
  "name": "GLM 5.2 High",
  "contextLength": 1000000,
  "maxOutputTokens": 131072,
  "toolCalling": true,
  "supportsReasoning": true
}, {
  "id": "glm-5.2-max",
  "name": "GLM 5.2 Max",
  "contextLength": 1000000,
  "maxOutputTokens": 131072,
  "toolCalling": true,
  "supportsReasoning": true
}, {
  "id": "glm-5-turbo",
  "name": "GLM 5 Turbo",
  "contextLength": 200000,
  "maxOutputTokens": 131072,
  "toolCalling": true,
  "supportsReasoning": true
}, {
  "id": "glm-4.7-flash",
  "name": "GLM 4.7 Flash",
  "contextLength": 200000,
  "maxOutputTokens": 131072,
  "toolCalling": true,
  "supportsReasoning": true
}, {
  "id": "glm-4.6",
  "name": "GLM 4.6",
  "contextLength": 200000,
  "maxOutputTokens": 32768,
  "toolCalling": true,
  "supportsReasoning": true
}, {
  "id": "glm-4.5v",
  "name": "GLM 4.5V (Vision)",
  "contextLength": 16000,
  "maxOutputTokens": 32768,
  "toolCalling": true,
  "supportsReasoning": true,
  "supportsVision": true
}, {
  "id": "glm-4.5",
  "name": "GLM 4.5",
  "contextLength": 128000,
  "maxOutputTokens": 32768,
  "toolCalling": true,
  "supportsReasoning": true
}, {
  "id": "glm-4.5-air",
  "name": "GLM 4.5 Air",
  "contextLength": 128000,
  "maxOutputTokens": 32768,
  "toolCalling": true,
  "supportsReasoning": true
}],
  features: {
    usage: true,
    usageApikey: true,
  },
};
