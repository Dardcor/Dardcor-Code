export default {
  id: "claude-web",
  priority: 150,
  alias: "cw",
  uiAlias: "cw",
  display: {
    name: "Claude Web (Subscription)",
    icon: "auto_awesome",
    color: "#D97757",
    textIcon: "CW",
    website: "https://claude.ai",
    notice: { signupUrl: "https://claude.ai" },
  },
  category: "webCookie",
  authType: "cookie",
  authHint:
    "Paste the sessionKey cookie from claude.ai (DevTools → Application → Cookies → claude.ai) or the full Cookie header. The cf_clearance cookie only works with the exact same User-Agent/TLS fingerprint as the browser, from the same IP.",
  transport: {
    baseUrl: "https://claude.ai/api/organizations",
    format: "openai",
    executor: "claude-web",
    authType: "cookie",
  },
  models: [
    { id: "claude-fable-5", name: "Claude Fable 5 (web)", toolCalling: false },
    { id: "claude-opus-5", name: "Claude Opus 5 (web)", toolCalling: false },
    { id: "claude-opus-4-8", name: "Claude Opus 4.8 (web)", toolCalling: false },
    { id: "claude-opus-4-7", name: "Claude Opus 4.7 (web)", toolCalling: false },
    { id: "claude-opus-4-6", name: "Claude Opus 4.6 (web)", toolCalling: false },
    { id: "claude-sonnet-5", name: "Claude Sonnet 5 (web)", toolCalling: false },
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6 (web)", toolCalling: false },
    { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5 (web)", toolCalling: false },
  ],
};
