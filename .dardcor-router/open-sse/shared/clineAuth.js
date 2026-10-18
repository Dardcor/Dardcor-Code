import pkg from "../../package.json" with { type: "json" };

const APP_VERSION = pkg.version || "0.0.0";

export function getClineAccessToken(token) {
  if (typeof token !== "string") return "";
  const trimmed = token.trim();
  if (!trimmed) return "";
  if (trimmed.toLowerCase().startsWith("workos:")) return trimmed;
  const isWorkOsJwt = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(trimmed);
  return isWorkOsJwt ? `workos:${trimmed}` : trimmed;
}

export function getClineAuthorizationHeader(token) {
  const accessToken = getClineAccessToken(token);
  return accessToken ? `Bearer ${accessToken}` : "";
}

export function buildClineHeaders(token, extraHeaders = {}) {
  const authorization = getClineAuthorizationHeader(token);
  const headers = {
    "HTTP-Referer": "https://cline.bot",
    "X-Title": "Cline",
    "User-Agent": `Dardcor Code/${APP_VERSION}`,
    "X-PLATFORM": process.platform || "unknown",
    "X-PLATFORM-VERSION": process.version || "unknown",
    "X-CLIENT-TYPE": "dardcor-code",
    "X-CLIENT-VERSION": APP_VERSION,
    "X-CORE-VERSION": APP_VERSION,
    "X-IS-MULTIROOT": "false",
    ...extraHeaders,
  };

  if (authorization) {
    headers.Authorization = authorization;
  }

  return headers;
}
