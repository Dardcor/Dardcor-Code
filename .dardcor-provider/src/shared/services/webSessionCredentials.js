// Web-session credential requirements, keyed by provider id. The dashboard UI
// (AddApiKeyModal / WebSessionCredentialGuide) derives its credential wording
// from this metadata instead of hardcoding per-provider copy. Only credential
// *names* live here — never actual values.
//
// kind: "token" (a localStorage/JWT-style value) or "cookie" (a browser cookie
//   header value)
// credentialName: what the user must copy, shown as-is in the UI
// placeholder: example paste text for the credential input
// acceptsFullCookieHeader: whether a full Cookie header (not just the named
//   cookies) is accepted
// storageKeys: keys the backend reads the credential from (informational here)
// hintFallback: optional provider-specific guidance replacing/augmenting the
//   generic copy (e.g. grok.com's cf_clearance IP/User-Agent/TLS pinning)

export const WEB_SESSION_CREDENTIAL_REQUIREMENTS = {
  "chatgpt-web": {
    kind: "cookie",
    credentialName: "__Secure-next-auth.session-token",
    placeholder: "__Secure-next-auth.session-token=...",
    acceptsFullCookieHeader: true,
    storageKeys: ["cookie", "sessionToken", "session-token", "__Secure-next-auth.session-token"],
  },
  "claude-web": {
    kind: "cookie",
    credentialName: "sessionKey",
    placeholder: "sessionKey=... or full Cookie header from claude.ai",
    acceptsFullCookieHeader: true,
    storageKeys: ["cookie", "sessionKey"],
  },
  "gemini-web": {
    kind: "cookie",
    credentialName: "__Secure-1PSID (optional: __Secure-1PSIDTS)",
    placeholder: "__Secure-1PSID=...; __Secure-1PSIDTS=...",
    acceptsFullCookieHeader: true,
    storageKeys: ["cookie", "__Secure-1PSID", "__Secure-1PSIDTS"],
  },
  "deepseek-web": {
    kind: "token",
    credentialName: "userToken",
    placeholder: "userToken=... or paste raw userToken",
    acceptsFullCookieHeader: false,
    storageKeys: ["token", "userToken"],
  },
  "grok-web": {
    kind: "cookie",
    credentialName: "sso + sso-rw",
    placeholder: "sso=...; sso-rw=...",
    acceptsFullCookieHeader: true,
    storageKeys: ["cookie", "sso", "sso-rw"],
    // grok.com's cf_clearance cookie is pinned to the IP, User-Agent, and TLS
    // fingerprint of the browser that earned it — pasting it from a different
    // machine/IP causes a 403 that is actually correct Cloudflare behavior.
    hintFallback:
      "grok.com's cf_clearance cookie is pinned to the IP, User-Agent, and TLS fingerprint of the browser where you copied it — pasting it from a different machine/IP causes a 403. Paste sso and sso-rw here, then open Advanced Settings and fill Custom User-Agent with the EXACT User-Agent string of that same browser, and use the same IP/proxy for this connection.",
  },
  "notion-web": {
    kind: "cookie",
    credentialName: "token_v2 (optional: space_id, notion_browser_id)",
    placeholder: "token_v2=...; space_id=...; notion_browser_id=...",
    acceptsFullCookieHeader: true,
    storageKeys: ["cookie", "token_v2", "space_id", "notion_browser_id"],
    // Minimal-exposure guidance: token_v2 alone usually suffices; sharing the
    // whole Cookie header widens exposure if the credential ever leaks.
    hintFallback:
      "Paste only the minimum: token_v2 alone usually works — add space_id and notion_browser_id only if a request needs them. Avoid pasting your full Cookie header: every extra cookie widens exposure if this credential ever leaks.",
  },
  "qwen-web": {
    kind: "cookie",
    credentialName: "full Cookie header (must include cna, ssxmod_itna, token)",
    placeholder:
      "cna=...; token=...; ssxmod_itna=...; ssxmod_itna2=... (full Cookie header from chat.qwen.ai)",
    acceptsFullCookieHeader: true,
    storageKeys: ["cookie", "token", "ssxmod_itna", "ssxmod_itna2", "cna", "tongyi_sso_ticket"],
  },
  "zai-web": {
    kind: "cookie",
    credentialName: "token",
    placeholder: "token=... or full Cookie header from chat.z.ai",
    acceptsFullCookieHeader: true,
    storageKeys: ["cookie", "token"],
  },
  "venice-web": {
    kind: "cookie",
    credentialName: "full Cookie header",
    placeholder: "Full Cookie header from venice.ai",
    acceptsFullCookieHeader: true,
    storageKeys: ["cookie"],
  },
  "v0-vercel-web": {
    kind: "cookie",
    credentialName: "full Cookie header",
    placeholder: "Full Cookie header from v0.dev",
    acceptsFullCookieHeader: true,
    storageKeys: ["cookie"],
  },
  "kimi-web": {
    kind: "token",
    credentialName: "access_token",
    placeholder: "access_token from www.kimi.com localStorage",
    acceptsFullCookieHeader: true,
    storageKeys: ["token", "access_token", "accessToken", "cookie", "kimi-auth"],
  },
  "manus-web": {
    kind: "cookie",
    credentialName: "session_id",
    placeholder: "session_id=... or full Cookie header from manus.im",
    acceptsFullCookieHeader: true,
    storageKeys: ["cookie", "session_id", "manus_session"],
  },
};

export function getWebSessionCredentialRequirement(providerId) {
  if (typeof providerId !== "string") return null;
  return WEB_SESSION_CREDENTIAL_REQUIREMENTS[providerId] ?? null;
}

function normalizeCredential(value) {
  return typeof value === "string"
    ? value.trim().replace(/^cookie\s*:\s*/i, "")
    : "";
}

function hasCookie(value, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|;\\s*)${escaped}(?:\\.\\d+)?=([^;]+)`).test(value);
}

export function validateWebSessionCredential(providerId, value) {
  const requirement = getWebSessionCredentialRequirement(providerId);
  if (!requirement) return null;

  const credential = normalizeCredential(value);
  if (!credential) {
    return { valid: false, error: `${requirement.credentialName} is required` };
  }

  if (providerId === "deepseek-web") {
    const token = credential.replace(/^userToken=/i, "").trim();
    try {
      const parsed = JSON.parse(token);
      return typeof parsed?.value === "string" && parsed.value.trim()
        ? { valid: true, error: null }
        : { valid: false, error: "userToken JSON must contain a non-empty value" };
    } catch {
      return token ? { valid: true, error: null } : { valid: false, error: "userToken is required" };
    }
  }

  if (providerId === "qwen-web") {
    const missing = ["cna", "ssxmod_itna", "token"].filter((name) => !hasCookie(credential, name));
    return missing.length === 0
      ? { valid: true, error: null }
      : { valid: false, error: `Qwen Cookie header is missing: ${missing.join(", ")}` };
  }

  if (providerId === "zai-web") {
    return hasCookie(credential, "token")
      ? { valid: true, error: null }
      : { valid: false, error: "Z.ai Cookie header must contain token=<JWT>" };
  }

  const requiredCookie = {
    "chatgpt-web": "__Secure-next-auth.session-token",
    "claude-web": "sessionKey",
    "gemini-web": "__Secure-1PSID",
    "notion-web": "token_v2",
    "manus-web": "session_id",
  }[providerId];

  if (!requiredCookie || !credential.includes("=")) {
    return { valid: true, error: null };
  }

  return hasCookie(credential, requiredCookie)
    ? { valid: true, error: null }
    : { valid: false, error: `Cookie header must contain ${requiredCookie}` };
}
