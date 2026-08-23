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
  },
  category: "free",
  noAuth: true,
  transport: {
    baseUrl: "https://opencode.ai",
    headers: {
      "x-opencode-client": "desktop",
    },
    noAuth: true,
  },
  models: [
    {
      id: "big-pickle",
      name: "Big Pickle",
      supportsReasoning: true,
      interleavedField: "reasoning_content",
      isFreeTier: true
    },
    {
      id: "deepseek-v4-flash-free",
      name: "DeepSeek V4 Flash Free",
      supportsReasoning: true,
      isFreeTier: true
    },
    {
      id: "x-preview-f-free",
      name: "X-Preview-F Free",
      contextLength: 131000,
      isFreeTier: true
    },
    {
      id: "muse-spark-1.2-contributor-free",
      name: "Muse Spark 1.2 Contributor Free",
      contextLength: 1048576,
      isFreeTier: true
    },
    {
      id: "mimo-v2.5-free",
      name: "MiMo V2.5 Free",
      contextLength: 131000,
      isFreeTier: true
    },
    {
      id: "hy3-free",
      name: "HY3 Free",
      contextLength: 131000,
      isFreeTier: true
    },
    {
      id: "nemotron-3-ultra-free",
      name: "Nemotron 3 Ultra Free",
      contextLength: 1000000,
      isFreeTier: true
    },
    {
      id: "nemotron-3.5-lightning-free",
      name: "Nemotron 3.5 Lightning Free",
      contextLength: 1000000,
      isFreeTier: true
    },
    {
      id: "laguna-s-2.1-free",
      name: "Laguna S 2.1 Free",
      contextLength: 131000,
      isFreeTier: true
    },
    {
      id: "north-mini-code-free",
      name: "North Mini Code Free",
      contextLength: 131000,
      isFreeTier: true
    }
  ],
  modelsFetcher: { url: "https://opencode.ai/zen/v1/models", type: "opencode-free" },
  passthroughModels: true,
};
