export default {
  id: "manus-web",
  priority: 191,
  alias: "manus-web",
  display: {
    name: "Manus Web",
    icon: "smart_toy",
    color: "#E85D3D",
    textIcon: "MN",
    website: "https://manus.im",
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste session_id=... or the full Cookie header from a signed-in manus.im session.",
  transport: {
    baseUrl: "https://api.manus.ai/v2/task.create",
    format: "openai",
    executor: "manus-web",
    authType: "cookie",
  },
  models: [
    { id: "manus-1.6", name: "Manus 1.6" },
    { id: "manus-1.6-lite", name: "Manus 1.6 Lite" },
    { id: "manus-1.6-max", name: "Manus 1.6 Max" },
  ],
};
