import { OPENCODE_CONFIG } from "../constants/oauth.js";

const opencode = {
  config: OPENCODE_CONFIG,
  flowType: "device_code",
  requestDeviceCode: async (config) => {
    const response = await fetch(config.deviceCodeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "opencode/stable/2.0.29/cli",
      },
      body: JSON.stringify({
        client_id: config.clientId || "opencode-cli",
        supports_org_scope: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenCode device code request failed: ${errorText}`);
    }

    const data = await response.json();
    const verificationUri = data.verification_uri?.startsWith("http")
      ? data.verification_uri
      : `https://opencode.ai${data.verification_uri || "/console/device"}`;
    const verificationUriComplete = data.verification_uri_complete?.startsWith("http")
      ? data.verification_uri_complete
      : `https://opencode.ai${data.verification_uri_complete || `/console/device?user_code=${data.user_code}&client_id=${config.clientId || "opencode-cli"}`}`;

    return {
      device_code: data.device_code,
      user_code: data.user_code,
      verification_uri: verificationUri,
      verification_uri_complete: verificationUriComplete,
      expires_in: data.expires_in,
      interval: data.interval || 5,
    };
  },
  pollToken: async (config, deviceCode) => {
    const response = await fetch(config.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "opencode/stable/2.0.29/cli",
      },
      body: JSON.stringify({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: deviceCode,
        client_id: config.clientId || "opencode-cli",
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
      const res = await fetch("https://opencode.ai/console/api/user", {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          Accept: "application/json",
          "User-Agent": "opencode/stable/2.0.29/cli",
        },
      });
      if (res.ok) {
        const user = await res.json();
        return { user };
      }
    } catch {
    }
    return { user: null };
  },
  mapTokens: (tokens, extra) => {
    const email = extra?.user?.email || null;
    const userId = extra?.user?.id || null;
    const displayName = email || (userId ? `OpenCode User ${userId}` : "OpenCode User");

    const expiresAt = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      : null;

    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || null,
      expiresIn: tokens.expires_in,
      expiresAt,
      email: email || undefined,
      displayName,
      name: displayName,
      providerSpecificData: {
        authMethod: "device_code",
        userId,
        orgId: tokens.org_id || null,
      },
    };
  },
};

export default opencode;
