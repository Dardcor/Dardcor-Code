export default {
  id: "alitp-intl",
  priority: 11,
  alias: "alitp-intl",
  display: {
    name: "Alibaba Token Plan",
    icon: "cloud",
    color: "#FF6A00",
    textIcon: "ATP",
    website: "https://www.alibabacloud.com/campaign/ai-landing-page-token",
    notice: {
      apiKeyUrl: "https://modelstudio.console.alibabacloud.com/?apiKey=1",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions",
    headers: {},
    quirks: { preserveCacheControl: true },
  },
  models: [
    { id: "qwen3.8-max-preview", name: "Qwen3.8 Max Preview" },
    { id: "qwen3.7-max", name: "Qwen3.7 Max" },
    { id: "qwen3.7-plus", name: "Qwen3.7 Plus" },
    { id: "qwen3.6-flash", name: "Qwen3.6 Flash" },
    { id: "glm-5.2", name: "GLM 5.2" },
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
  ],
};
