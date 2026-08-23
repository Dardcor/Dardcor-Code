// Qwen Web — Alibaba Tongyi consumer chat via chat.qwen.ai (v2 API).
// Category is webCookie: the full browser Cookie jar from a logged-in session
// (cna, ssxmod_itna, token, ...) is replayed verbatim plus the bearer token.
// The executor emits OpenAI-compatible output directly (responseFormat openai).
export default {
  id: "qwen-web",
  priority: 170,
  alias: "qwen-web",
  display: {
    name: "Qwen Web",
    icon: "bolt",
    color: "#6A5AE0",
    textIcon: "QW",
    website: "https://chat.qwen.ai",
  },
  category: "webCookie",
  authType: "cookie",
  authHint:
    "Paste the full Cookie header from a logged-in chat.qwen.ai session (DevTools → Network → any request → Copy as cURL, or Application → Cookies). It must include the cna, ssxmod_itna and token cookies — a bare bearer token alone is rejected by Qwen's WAF. Treated as a password — never share it.",
  transport: {
    baseUrl: "https://chat.qwen.ai",
    format: "openai",
  },
  models: [
    { id: "qwen3.8-max-preview", name: "Qwen3.8 Max Preview" },
    { id: "qwen3.7-max", name: "Qwen3.7 Max" },
    { id: "qwen3.7-plus", name: "Qwen3.7 Plus" },
    { id: "qwen3.6-plus", name: "Qwen3.6 Plus" },
  ],
};
