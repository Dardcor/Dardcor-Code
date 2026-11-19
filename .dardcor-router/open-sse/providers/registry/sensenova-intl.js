export default {
  id: "sensenova-intl",
  alias: "sensenova-intl",
  display: {
    name: "SenseNova (Intl)",
    icon: "auto_awesome",
    color: "#5B5CE2",
    textIcon: "SN",
    website: "https://platform.sensenova.ai",
    notice: {
      text: "For international accounts (platform.sensenova.ai). China accounts (token.sensenova.cn) use the SenseNova provider.",
      apiKeyUrl: "https://platform.sensenova.ai",
    },
  },
  category: "apikey",
  thinkingConfig: {
    options: ["none", "low", "medium", "high", "max"],
    defaultMode: "high",
  },
  transport: {
    baseUrl: "https://token.sensenova.ai/v1/chat/completions",
    validateUrl: "https://token.sensenova.ai/v1/models",
    quirks: {
      reasoningAliasFields: true,
    },
  },
  models: [
    { id: "sensenova-6.8-flash", name: "SenseNova 6.8 Flash" },
    { id: "sensenova-6.8-flash-lite", name: "SenseNova 6.8 Flash Lite" },
    { id: "sensenova-6.7-flash-lite", name: "SenseNova 6.7 Flash Lite" },
    {
      id: "sensenova-u1.5-lite",
      name: "SenseNova U1.5 Lite",
      kind: "image",
      capabilities: ["text2img", "edit"],
      params: ["n", "size", "output_format", "response_format", "watermark", "prompt_extend"],
    },
    {
      id: "sensenova-u1-fast",
      name: "SenseNova U1 Fast",
      kind: "image",
      capabilities: ["text2img"],
      params: ["n", "size", "output_format", "response_format", "watermark", "prompt_extend"],
    },
  ],
  serviceKinds: ["llm", "image", "imageToText"],
  imageConfig: {
    baseUrl: "https://token.sensenova.ai/v1/images/generations",
    bodyFields: [
      "model",
      "prompt",
      "n",
      "size",
      "output_format",
      "response_format",
      "watermark",
      "prompt_extend",
    ],
  },
};
