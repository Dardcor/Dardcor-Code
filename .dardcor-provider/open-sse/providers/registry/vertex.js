export default {
  id: "vertex",
  priority: 40,
  alias: "vertex",
  aliases: [
    "vx",
  ],
  uiAlias: "vx",
  display: {
    name: "Vertex AI",
    icon: "cloud",
    color: "#4285F4",
    textIcon: "VX",
    website: "https://cloud.google.com/vertex-ai",
    notice: {
      text: "New Google Cloud accounts get $300 free credits. Requires GCP project + Service Account with Vertex AI API enabled.",
      apiKeyUrl: "https://console.cloud.google.com/iam-admin/serviceaccounts",
    },
  },
  category: "freeTier",
  transport: {
    baseUrl: "https://aiplatform.googleapis.com",
    format: "vertex",
  },
  models: [{
  id: "gemini-3.1-pro-preview",
  name: "Gemini 3.1 Pro Preview"
}, {
  id: "gemini-3.1-flash-lite-preview",
  name: "Gemini 3.1 Flash Lite Preview"
}, {
  id: "gemini-3-flash-preview",
  name: "Gemini 3 Flash Preview"
}, {
  id: "gemini-2.5-flash",
  name: "Gemini 2.5 Flash"
}, {
  "id": "gemini-3.1-flash-lite",
  "name": "Gemini 3.1 Flash Lite (Vertex)"
}, {
  "id": "gemma-4-31b-it",
  "name": "Gemma 4 31B (Vertex)"
}, {
  "id": "DeepSeek-V4-Flash",
  "name": "DeepSeek V4 Flash (Vertex Partner)"
}, {
  "id": "DeepSeek-V4-Pro",
  "name": "DeepSeek V4 Pro (Vertex Partner)"
}, {
  "id": "Qwen3.6-35B-A3B",
  "name": "Qwen3.6 35B A3B (Vertex Partner)"
}, {
  "id": "GLM-5.1-FP8",
  "name": "GLM-5.1 (Vertex Partner)"
}, {
  "id": "claude-opus-4-7",
  "name": "Claude Opus 4.7 (Vertex)"
}, {
  "id": "claude-sonnet-4-6",
  "name": "Claude Sonnet 4.6 (Vertex)"
}],
  serviceKinds: ["llm","imageToText"],
};
