export default {
  id: "reka",
  alias: "reka",
  category: "freeTier",
  hasFree: true,
  authType: "apikey",
  authHint: "Use your Reka API key. OmniRoute supports the OpenAI-compatible base URL https://api.reka.ai/v1 and sends both Authorization and X-Api-Key headers for compatibility.",
  display: {
    name: "Reka",
    icon: "auto_awesome",
    color: "#111827",
    textIcon: "RK",
    website: "https://docs.reka.ai/chat/overview",
  },
  transport: {
    baseUrl: "https://api.reka.ai/v1/chat/completions",
    auth: { combined: true, header: "Authorization", scheme: "bearer", hooks: ["rekaAuth"] },
  },
  models: [
    { id: "reka-flash-3", name: "Reka Flash 3" },
    { id: "reka-flash", name: "Reka Flash" },
    { id: "reka-edge-2603", name: "Reka Edge 2603" },
  ],
};
