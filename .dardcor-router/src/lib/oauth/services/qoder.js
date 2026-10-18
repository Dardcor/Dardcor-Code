import {
  QODER_DEVICE_TOKEN_URL,
  QODER_LOGIN_URL,
  QODER_USERINFO_URL,
} from "../../qoder/constants.js";
import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";


const FETCH_TIMEOUT_MS = 15_000;

function base64Url(buf) {
  return buf
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export class QoderService {
  generatePkcePair() {
    const verifier = base64Url(crypto.randomBytes(32));
    const challenge = base64Url(crypto.createHash("sha256").update(verifier).digest());
    return { verifier, challenge };
  }

  initiateDeviceFlow() {
    const { verifier, challenge } = this.generatePkcePair();
    const nonce = uuidv4();
    const machineId = uuidv4();

    const params = new URLSearchParams({
      challenge,
      challenge_method: "S256",
      machine_id: machineId,
      nonce,
    });

    return {
      verificationUriComplete: `${QODER_LOGIN_URL}?${params.toString()}`,
      codeVerifier: verifier,
      nonce,
      machineId,
    };
  }

  async pollDeviceToken({ nonce, codeVerifier }) {
    if (!nonce || !codeVerifier) {
      throw new Error("pollDeviceToken: missing nonce or code verifier");
    }
    const url = `${QODER_DEVICE_TOKEN_URL}?nonce=${encodeURIComponent(nonce)}&verifier=${encodeURIComponent(codeVerifier)}&challenge_method=S256`;

    const response = await fetchWithTimeout(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "Go-http-client/2.0",
      },
    });

    if (response.status === 202 || response.status === 404) {
      return { status: "pending" };
    }

    const text = await response.text();

    if (!response.ok) {
      let message = `Qoder device token poll failed: HTTP ${response.status}`;
      try {
        const body = JSON.parse(text);
        if (body.message) message = `Qoder device token poll failed: ${body.message}`;
      } catch {}
      throw new Error(message);
    }

    let body;
    try {
      body = JSON.parse(text);
    } catch (err) {
      throw new Error(`Qoder device token poll: invalid JSON response (${err.message})`);
    }

    if (!body.token) {
      throw new Error("Qoder device token poll returned 200 but no token");
    }

    const expireMs = QoderService.parseExpiry(body.expires_at, body.expires_in);

    return {
      status: "ok",
      accessToken: body.token,
      refreshToken: body.refresh_token || "",
      userId: body.user_id || "",
      expireTime: expireMs,
      rawResponse: body,
    };
  }

  async fetchUserInfo(accessToken) {
    try {
      const response = await fetchWithTimeout(QODER_USERINFO_URL, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          "User-Agent": "Go-http-client/2.0",
        },
      });
      if (!response.ok) return { name: "", email: "" };
      const body = await response.json();
      return {
        name: (body.name || body.username || "").trim(),
        email: (body.email || "").trim(),
        organizationId: (body.organization_id || "").trim(),
      };
    } catch {
      return { name: "", email: "" };
    }
  }

  static parseExpiry(expiresAt, expiresInSeconds) {
    if (typeof expiresAt === "number" && Number.isFinite(expiresAt) && expiresAt > 0) {
      return expiresAt;
    }
    const trimmed = typeof expiresAt === "string" ? expiresAt.trim() : "";
    if (trimmed) {
      if (/^\d+$/.test(trimmed)) {
        const ms = Number.parseInt(trimmed, 10);
        if (Number.isFinite(ms) && ms > 0) return ms;
      }
      const parsed = Date.parse(trimmed);
      if (!Number.isNaN(parsed)) return parsed;
    }
    if (typeof expiresInSeconds === "number" && Number.isFinite(expiresInSeconds) && expiresInSeconds >= 0) {
      return Date.now() + expiresInSeconds * 1000;
    }
    return Date.now() + 30 * 24 * 60 * 60 * 1000;
  }
}
