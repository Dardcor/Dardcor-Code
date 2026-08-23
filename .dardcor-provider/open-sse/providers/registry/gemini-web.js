export default {
  id: "gemini-web",
  priority: 150,
  alias: "gweb",
  uiAlias: "gweb",
  display: {
    name: "Gemini Web (Subscription)",
    icon: "auto_awesome",
    color: "#4285F4",
    textIcon: "GW",
    website: "https://gemini.google.com",
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste your __Secure-1PSID cookie value from gemini.google.com (DevTools → Application → Cookies → gemini.google.com). For long-lived sessions also paste __Secure-1PSIDTS, or paste the full Cookie header.",
  transport: {
    baseUrl: "https://gemini.google.com/app",
    format: "openai",
    executor: "gemini-web",
  },
  models: [
    { id: "gemini-3.1-pro", name: "Gemini 3.1 Pro", toolCalling: false },
    { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash", toolCalling: false },
    { id: "gemini-3.1-flash-lite", name: "Gemini 3.1 Flash-Lite", toolCalling: false },
  ],
};
