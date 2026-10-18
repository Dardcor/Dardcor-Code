import { GITHUB_CONFIG } from "../constants/oauth.js";
import { GITHUB_COPILOT } from "open-sse/config/appConstants.js";

const github = {
  config: GITHUB_CONFIG,
  flowType: "device_code",
  requestDeviceCode: async (config) => {
    const response = await fetch(config.deviceCodeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        client_id: config.clientId,
        scope: config.scopes,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Device code request failed: ${error}`);
    }

    return await response.json();
  },
  pollToken: async (config, deviceCode) => {
    const response = await fetch(config.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        client_id: config.clientId,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });

    let data;
    try {
      data = await response.json();
    } catch {
      const text = await response.text();
      data = { error: "invalid_response", error_description: text };
    }

    return {
      ok: response.ok,
      data: data,
    };
  },
  postExchange: async (tokens) => {
    let copilotToken = {};
    try {
      const copilotUrl = GITHUB_CONFIG.copilotTokenUrl || "https://api.github.com/copilot_internal/v2/token";
      const copilotRes = await fetch(copilotUrl, {
        headers: {
          Authorization: `token ${tokens.access_token}`,
          Accept: "application/json",
          "User-Agent": GITHUB_COPILOT.USER_AGENT || GITHUB_CONFIG.userAgent || "GitHubCopilotChat/0.38.0",
          "Editor-Version": `vscode/${GITHUB_COPILOT.VSCODE_VERSION || "1.110.0"}`,
          "Editor-Plugin-Version": `copilot-chat/${GITHUB_COPILOT.COPILOT_CHAT_VERSION || "0.38.0"}`,
          "x-github-api-version": GITHUB_COPILOT.API_VERSION || GITHUB_CONFIG.apiVersion || "2025-04-01",
        },
      });
      if (copilotRes.ok) {
        copilotToken = await copilotRes.json();
      } else {
        const errorText = await copilotRes.text();
        console.error(`[GITHUB] Copilot token exchange returned ${copilotRes.status}: ${errorText}`);
      }
    } catch (err) {
      console.error("[GITHUB] Error exchanging Copilot token:", err?.message || err);
    }

    let userInfo = {};
    try {
      const userRes = await fetch(GITHUB_CONFIG.userInfoUrl || "https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          Accept: "application/json",
          "User-Agent": GITHUB_COPILOT.USER_AGENT || "Dardcor Code",
        },
      });
      if (userRes.ok) {
        userInfo = await userRes.json();
      }
    } catch (err) {
      console.error("[GITHUB] Error fetching user info:", err?.message || err);
    }

    return { copilotToken, userInfo };
  },
  mapTokens: (tokens, extra) => ({
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || null,
    expiresIn: tokens.expires_in || null,
    name: extra?.userInfo?.login || extra?.userInfo?.name || "GitHub Copilot",
    displayName: extra?.userInfo?.name || extra?.userInfo?.login || "GitHub Copilot",
    email: extra?.userInfo?.email || null,
    providerSpecificData: {
      copilotToken: extra?.copilotToken?.token || null,
      copilotTokenExpiresAt: extra?.copilotToken?.expires_at || null,
      githubUserId: extra?.userInfo?.id || null,
      githubLogin: extra?.userInfo?.login || null,
      githubName: extra?.userInfo?.name || null,
      githubEmail: extra?.userInfo?.email || null,
    },
  }),
};

export default github;
