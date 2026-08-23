// Z.ai consumer web chat (chat.z.ai) — hand-fed full Cookie header.
// Category is webCookie: the credential is the browser session Cookie blob
// (must contain `token=<JWT>`); the executor replays it as Cookie plus
// Authorization: Bearer <token>. Free web-session auth, no API key needed.
export default {
  id: "zai-web",
  priority: 210,
  alias: "zw",
  display: {
    name: "Z.ai Web",
    icon: "bolt",
    color: "#1F7A5C",
    textIcon: "ZA",
    website: "https://chat.z.ai",
  },
  category: "webCookie",
  authType: "cookie",
  authHint:
    "Paste the full Cookie header from chat.z.ai (DevTools → Network → copy the request Cookie header). Must contain token=<JWT> — the gateway needs the whole cookie blob, not the bare JWT.",
  transport: {
    baseUrl: "https://chat.z.ai/api/v2/chat/completions",
    format: "openai",
    authType: "cookie",
  },
  hasFree: true,
  passthroughModels: true,
  models: [
    { id: "glm-5.3", name: "GLM-5.3", isFreeTier: true },
    { id: "glm-5.2", name: "GLM-5.2", isFreeTier: true },
    { id: "glm-5", name: "GLM-5", isFreeTier: true },
    { id: "glm-4.7", name: "GLM-4.7", isFreeTier: true },
    { id: "glm-4.6", name: "GLM-4.6", isFreeTier: true },
    { id: "glm-4.5", name: "GLM-4.5", isFreeTier: true },
    { id: "glm-4.5v", name: "GLM-4.5V", isFreeTier: true },
  ],
};
