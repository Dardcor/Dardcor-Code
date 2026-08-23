export default {
  id: "venice-web",
  priority: 190,
  alias: "venice-web",
  display: {
    name: "Venice Web (Privacy)",
    icon: "auto_awesome",
    color: "#22C55E",
    textIcon: "VW",
    website: "https://venice.ai",
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste the full Cookie header from a signed-in venice.ai session.",
  transport: {
    baseUrl: "https://venice.ai/api/chat",
    format: "openai",
    executor: "venice-web",
    authType: "cookie",
  },
  models: [{ id: "venice-default", name: "Venice Default" }],
  passthroughModels: true,
};
