export default {
  id: "v0-vercel-web",
  priority: 200,
  alias: "v0-vercel-web",
  display: {
    name: "v0 Vercel Web (Code Gen)",
    icon: "auto_awesome",
    color: "#000000",
    textIcon: "V0",
    website: "https://v0.dev",
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste the full Cookie header from a signed-in v0.dev session.",
  transport: {
    baseUrl: "https://v0.dev/api/chat",
    format: "openai",
    executor: "v0-vercel-web",
    authType: "cookie",
  },
  models: [{ id: "v0-default", name: "v0 Default" }],
  passthroughModels: true,
};
