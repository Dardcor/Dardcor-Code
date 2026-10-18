import { GROK_CLI_CONFIG } from "../constants/oauth.js";
import { decodeXaiIdTokenEmail, extractEmailFromAccessToken } from "../providerHelpers.js";

const grokCli = {
  config: GROK_CLI_CONFIG,
  flowType: "device_code",
  requestDeviceCode: async (config) => {
    const body = new URLSearchParams({
      client_id: config.clientId,
      scope: config.scope,
    });
    if (config.referrer) body.set("referrer", config.referrer);

    const response = await fetch(config.deviceCodeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "User-Agent": "grok-pager/0.2.93 grok-shell/0.2.93 (linux; x86_64)",
      },
      body,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Grok CLI device code request failed: ${error}`);
    }

    return await response.json();
  },
  pollToken: async (config, deviceCode) => {
    const response = await fetch(config.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "User-Agent": "grok-pager/0.2.93 grok-shell/0.2.93 (linux; x86_64)",
      },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: deviceCode,
        client_id: config.clientId,
      }),
    });

    let data;
    try {
      data = await response.json();
    } catch {
      const text = await response.text();
      data = { error: "invalid_response", error_description: text };
    }

    const pending =
      data?.error === "authorization_pending" ||
      data?.error === "slow_down";
    return {
      ok: response.ok || pending,
      data,
    };
  },
  postExchange: async (tokens) => {
    try {
      const res = await fetch("https://cli-chat-proxy.grok.com/v1/user", {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          Accept: "application/json",
          "User-Agent": "grok-pager/0.2.93 grok-shell/0.2.93 (linux; x86_64)",
          "x-xai-token-auth": "xai-grok-cli",
          "x-grok-client-version": "0.2.93",
        },
      });
      if (res.ok) return { user: await res.json() };
    } catch {
    }
    return { user: null };
  },
  mapTokens: (tokens, extra) => {
    const email =
      decodeXaiIdTokenEmail(tokens.id_token) ||
      extractEmailFromAccessToken(tokens.access_token) ||
      extra?.user?.email ||
      null;
    const userId =
      extra?.user?.userId ||
      extra?.user?.principalId ||
      null;
    const displayName = [extra?.user?.firstName, extra?.user?.lastName]
      .filter(Boolean)
      .join(" ")
      .trim() || null;

    const expiresAt = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      : null;

    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || null,
      expiresIn: tokens.expires_in,
      expiresAt,
      scope: tokens.scope,
      email: email || undefined,
      displayName: displayName || undefined,
      providerSpecificData: {
        authMethod: "device_code",
        idToken: tokens.id_token || null,
        email: email || null,
        userId,
        hasGrokCodeAccess: extra?.user?.hasGrokCodeAccess ?? null,
        subscriptionTier: extra?.user?.subscriptionTier ?? null,
      },
    };
  },
};

export default grokCli;
