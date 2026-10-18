import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { OAUTH_ENDPOINTS, GEMINI_CLI_API_CLIENT, geminiCLIUserAgent } from "../config/appConstants.js";

export class GeminiCLIExecutor extends BaseExecutor {
  constructor() {
    super("gemini-cli", PROVIDERS["gemini-cli"]);
  }

  buildUrl(model, stream, urlIndex = 0) {
    const action = stream ? "streamGenerateContent?alt=sse" : "generateContent";
    return `${this.config.baseUrl}:${action}`;
  }

  buildHeaders(credentials, stream = true) {
    return {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${credentials.accessToken}`,
      "User-Agent": geminiCLIUserAgent(this._currentModel),
      "X-Goog-Api-Client": GEMINI_CLI_API_CLIENT,
      "Accept": stream ? "text/event-stream" : "application/json"
    };
  }

  transformRequest(model, body, stream, credentials) {
    this._currentModel = model;
    if (body && body.request && body.model) return body;
    return {
      project: credentials?.projectId || body?.project,
      model,
      request: body
    };
  }

  parseError(response, bodyText) {
    const base = super.parseError(response, bodyText);
    if (response.status !== 429 || !bodyText) return base;
    try {
      const parsed = JSON.parse(bodyText);
      const details = parsed?.error?.details;
      if (Array.isArray(details)) {
        for (const d of details) {
          if (d?.["@type"] === "type.googleapis.com/google.rpc.RetryInfo" && d?.retryDelay) {
            base.retryAfter = d.retryDelay;
            break;
          }
        }
      }
    } catch {}
    return base;
  }

  async refreshCredentials(credentials, log) {
    if (!credentials.refreshToken) return null;

    try {
      const response = await fetch(OAUTH_ENDPOINTS.google.token, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: credentials.refreshToken,
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret
        })
      });

      if (!response.ok) return null;

      const tokens = await response.json();
      log?.info?.("TOKEN", "Gemini CLI refreshed");

      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || credentials.refreshToken,
        expiresIn: tokens.expires_in,
        projectId: credentials.projectId
      };
    } catch (error) {
      log?.error?.("TOKEN", `Gemini CLI refresh error: ${error.message}`);
      return null;
    }
  }
}

export default GeminiCLIExecutor;
