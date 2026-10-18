import { OPENCODE_CONFIG } from "../constants/oauth.js";

const FETCH_TIMEOUT_MS = 20_000;

async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export class OpenCodeService {
  constructor(config = OPENCODE_CONFIG) {
    this.config = config;
  }

  async requestDeviceCode() {
    const response = await fetchWithTimeout(this.config.deviceCodeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "opencode/stable/2.0.29/cli",
      },
      body: JSON.stringify({
        client_id: this.config.clientId || "opencode-cli",
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
      : `https://opencode.ai${data.verification_uri_complete || `/console/device?user_code=${data.user_code}&client_id=${this.config.clientId || "opencode-cli"}`}`;

    return {
      device_code: data.device_code,
      user_code: data.user_code,
      verification_uri: verificationUri,
      verification_uri_complete: verificationUriComplete,
      expires_in: data.expires_in,
      interval: data.interval || 5,
    };
  }

  async pollDeviceToken(deviceCode) {
    const response = await fetchWithTimeout(this.config.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "opencode/stable/2.0.29/cli",
      },
      body: JSON.stringify({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: deviceCode,
        client_id: this.config.clientId || "opencode-cli",
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
  }

  async refreshAccessToken(refreshToken) {
    const response = await fetchWithTimeout(this.config.refreshUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "opencode/stable/2.0.29/cli",
      },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: this.config.clientId || "opencode-cli",
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenCode token refresh failed: ${errorText}`);
    }

    return await response.json();
  }

  async getUserInfo(accessToken) {
    try {
      const response = await fetchWithTimeout(this.config.userUrl || "https://opencode.ai/console/api/user", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          "User-Agent": "opencode/stable/2.0.29/cli",
        },
      });
      if (response.ok) {
        return await response.json();
      }
    } catch {
    }
    return null;
  }
}
