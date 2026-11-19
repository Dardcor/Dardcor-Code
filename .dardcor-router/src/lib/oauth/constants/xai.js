import { PROVIDERS } from "open-sse/providers/index.js";

export const XAI_CLIENT_ID = PROVIDERS["xai"]?.clientId;

export const XAI_ISSUER = "https://auth.x.ai";
export const XAI_AUTH_ENDPOINT_PATH = "/oauth2/authorize";
export const XAI_TOKEN_ENDPOINT_PATH = "/oauth2/token";
export const XAI_DISCOVERY_PATH = "/.well-known/openid-configuration";

export const XAI_SCOPE = "openid profile email offline_access grok-cli:access api:access";

export const XAI_API_BASE = "https://api.x.ai/v1";

export const XAI_LOOPBACK_PORT = 56121;
export const XAI_CALLBACK_PATH = "/callback";
export const XAI_REDIRECT_URI = `http://127.0.0.1:${XAI_LOOPBACK_PORT}${XAI_CALLBACK_PATH}`;

export const XAI_PKCE_VERIFIER_BYTES = 96;

export const XAI_REFRESH_LEAD_SECONDS = 5 * 60;

export const XAI_USER_AGENT = "grok-cli/dardcor-code";

export const XAI_CONFIG = {
  clientId: XAI_CLIENT_ID,
  issuer: XAI_ISSUER,
  authEndpointPath: XAI_AUTH_ENDPOINT_PATH,
  tokenEndpointPath: XAI_TOKEN_ENDPOINT_PATH,
  discoveryPath: XAI_DISCOVERY_PATH,
  authorizeUrl: `${XAI_ISSUER}${XAI_AUTH_ENDPOINT_PATH}`,
  tokenUrl: `${XAI_ISSUER}${XAI_TOKEN_ENDPOINT_PATH}`,
  discoveryUrl: `${XAI_ISSUER}${XAI_DISCOVERY_PATH}`,
  scope: XAI_SCOPE,
  apiBaseUrl: XAI_API_BASE,
  redirectUri: XAI_REDIRECT_URI,
  loopbackPort: XAI_LOOPBACK_PORT,
  callbackPath: XAI_CALLBACK_PATH,
  pkceVerifierBytes: XAI_PKCE_VERIFIER_BYTES,
  refreshLeadSeconds: XAI_REFRESH_LEAD_SECONDS,
  userAgent: XAI_USER_AGENT,
  codeChallengeMethod: "S256",
};
