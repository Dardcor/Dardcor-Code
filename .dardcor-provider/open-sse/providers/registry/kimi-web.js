// Kimi consumer web chat (www.kimi.com Connect-RPC) — hand-fed access_token.
// The credential is the SPA's localStorage access_token forwarded as
// Authorization: Bearer; it lives with the other browser-session providers.
export default {
  id: "kimi-web",
  priority: 171,
  alias: "kimi-web",
  display: {
    name: "Kimi Web",
    icon: "psychology",
    color: "#1E3A8A",
    textIcon: "KM",
    website: "https://www.kimi.com",
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste the access_token from www.kimi.com localStorage (DevTools → Application → Local Storage → https://www.kimi.com). Treated as a password — never share it.",
  transport: {
    baseUrl: "https://www.kimi.com/apiv2/kimi.gateway.chat.v1.ChatService/Chat",
    format: "openai",
    authType: "cookie",
  },
  models: [
    { id: "k3", name: "Kimi K3" },
    { id: "k2d6", name: "Kimi K2.6" },
  ],
};
