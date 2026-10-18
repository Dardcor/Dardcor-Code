export default {
  id: "opencode",
  priority: 40,
  hasFree: true,
  alias: "oc",
  uiAlias: "oc",
  display: {
    name: "OpenCode Free",
    icon: "terminal",
    color: "#E87040",
    textIcon: "OC",
    website: "https://opencode.ai",
    notice: {
      text: "OpenCode Free Models (Zen). Tanpa login/API key, langsung terhubung ke upstream.",
    },
  },
  category: "free",
  noAuth: true,
  transport: {
    baseUrl: "https://opencode.ai",
    noAuth: true,
    headers: {
      "x-opencode-client": "desktop",
    },
    forceStream: true,
    quirks: {
      forceAutoToolChoiceModels: ["muse-spark-1.3-contributor-free", "muse-spark-1.2-contributor-free"],
    },
  },
  models: [
    { id: "cat-jam-free", name: "Cat Jam Free" },
    { id: "longcat-2.5-preview-free", name: "LongCat 2.5 Preview Free" },
    { id: "nemotron-3.5-lightning-free", name: "Nemotron 3.5 Lightning Free" },
    { id: "step-5-preview-free", name: "Step 5 Preview Free" },
    { id: "deepseek-v4.1-flash-free", name: "DeepSeek V4.1 Flash Free" },
    { id: "big-pickle", name: "Big Pickle" },
    { id: "mimo-v2.6-flash-free", name: "MiMo V2.6 Flash Free" },
    { id: "space-bunny-free", name: "Space Bunny Free" },
    { id: "muse-spark-1.3-contributor-free", name: "Muse Spark 1.3 Contributor Free", targetFormat: "openai-responses" },
    { id: "muse-spark-1.2-contributor-free", name: "Muse Spark 1.2 Contributor Free", targetFormat: "openai-responses" },
    { id: "nemotron-3.5-super-vl-free", name: "Nemotron 3.5 Super VL Free" },
    { id: "jev-1.13-free", name: "Jev 1.13 Free", kind: "systemone" },
  ],
  serviceKinds: ["llm", "systemone"],
  systemoneConfig: {
    baseUrl: "https://opencode.ai/zen/v1/systemone",
    headers: {
      "x-opencode-client": "desktop",
      "User-Agent": "opencode/1.19.0 ai-sdk/provider-utils/4.0.40 runtime/bun/1.3.14",
    },
  },
  modelsFetcher: { url: "https://opencode.ai/zen/v1/models", type: "opencode-free" },
  passthroughModels: true,
};
