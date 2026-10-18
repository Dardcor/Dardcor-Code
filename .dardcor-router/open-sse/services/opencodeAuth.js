import { getProviderConnections } from "../../src/lib/localDb.js";
import { refreshAccessToken } from "./tokenRefresh/providers.js";

const DEFAULT_SERVER = "https://opencode.ai/console";
const CLIENT_ID = "opencode-cli";
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

export async function requestDeviceCode(server = DEFAULT_SERVER) {
  const response = await fetchWithTimeout(`${server}/auth/device/code`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "opencode/stable/2.0.29/cli",
    },
    body: JSON.stringify({
      client_id: CLIENT_ID,
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
    : `https://opencode.ai${data.verification_uri_complete || `/console/device?user_code=${data.user_code}&client_id=${CLIENT_ID}`}`;

  return {
    device_code: data.device_code,
    user_code: data.user_code,
    verification_uri: verificationUri,
    verification_uri_complete: verificationUriComplete,
    expires_in: data.expires_in,
    interval: data.interval || 5,
  };
}

export async function pollDeviceToken(deviceCode, server = DEFAULT_SERVER) {
  const response = await fetchWithTimeout(`${server}/auth/device/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "opencode/stable/2.0.29/cli",
    },
    body: JSON.stringify({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: deviceCode,
      client_id: CLIENT_ID,
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

export async function refreshOpencodeAccessToken(refreshToken, server = DEFAULT_SERVER) {
  const response = await fetchWithTimeout(`${server}/auth/device/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "opencode/stable/2.0.29/cli",
    },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenCode token refresh failed: ${errorText}`);
  }

  return await response.json();
}

export async function resolveOpencodeCredentials(existingCredentials = null) {
  if (existingCredentials?.accessToken && existingCredentials.accessToken !== "public") {
    return existingCredentials;
  }
  if (existingCredentials?.apiKey) {
    return existingCredentials;
  }

  const envToken = process.env.OPENCODE_ACCESS_TOKEN || process.env.OPENCODE_API_KEY;
  if (envToken) {
    return {
      ...(existingCredentials || {}),
      accessToken: envToken,
    };
  }

  try {
    const conns = await getProviderConnections({ provider: "opencode", isActive: true });
    if (conns && conns.length > 0) {
      const activeConn = conns[0];
      return {
        ...(existingCredentials || {}),
        accessToken: activeConn.accessToken || null,
        apiKey: activeConn.apiKey || null,
        id: activeConn.id,
      };
    }
  } catch {
  }

  return existingCredentials || {};
}
