/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import "open-sse/index.js";

import { generatePKCE } from "../utils/pkce.js";
import { extractCodexAccountInfo, fetchKiroProfileArn } from "../providerHelpers.js";

import claude from "./claude.js";
import codex from "./codex.js";
import xai from "./xai.js";
import grokCli from "./grok-cli.js";
import geminiCli from "./gemini-cli.js";
import antigravity from "./antigravity.js";
import iflow from "./iflow.js";
import qoder from "./qoder.js";
import kiro from "./kiro.js";
import cursor from "./cursor.js";
import kimi from "./kimi.js";
import kilocode from "./kilocode.js";
import cline from "./cline.js";
import clinepass from "./clinepass.js";
import gitlab from "./gitlab.js";
import codebuddyCn from "./codebuddy-cn.js";
import codebuddyIntl from "./codebuddy-intl.js";
import kimchi from "./kimchi.js";
import trae from "./trae.js";
import windsurf from "./windsurf.js";
import zed from "./zed.js";
import opencode from "./opencode.js";
import github from "./github.js";
import glm from "./glm.js";

const PROVIDERS = {
  claude,
  codex,
  xai,
  "grok-cli": grokCli,
  "gemini-cli": geminiCli,
  antigravity,
  iflow,
  qoder,
  github,
  kiro,
  cursor,
  kimi,
  kilocode,
  cline,
  clinepass,
  gitlab,
  "codebuddy-cn": codebuddyCn,
  "codebuddy-intl": codebuddyIntl,
  kimchi,
  trae,
  windsurf,
  zed,
  opencode,
  glm,
};

export { PROVIDERS };

export { extractCodexAccountInfo, fetchKiroProfileArn };

export function getProvider(name) {
  const key = name === "kimi-coding" ? "kimi" : name;
  const provider = PROVIDERS[key];
  if (!provider) {
    throw new Error(`Unknown provider: ${name}`);
  }
  return provider;
}

export function getProviderNames() {
  return Object.keys(PROVIDERS);
}

export async function generateAuthData(providerName, redirectUri, meta) {
  const provider = getProvider(providerName);
  const config = provider.prepareConfig
    ? await provider.prepareConfig(provider.config, meta || {})
    : provider.config;
  const { codeVerifier: pkceVerifier, codeChallenge, state: pkceState } = generatePKCE(provider.pkceVerifierBytes);
  const state = config.loginTraceID || pkceState;
  const codeVerifier = config.privateKeyVerifier || pkceVerifier;

  let authUrl;
  if (provider.flowType === "device_code") {
    authUrl = null;
  } else if (provider.flowType === "authorization_code_pkce") {
    authUrl = provider.buildAuthUrl(config, redirectUri, state, codeChallenge, meta || {});
  } else {
    authUrl = provider.buildAuthUrl(config, redirectUri, state, undefined, meta || {});
  }

  return {
    authUrl,
    state,
    codeVerifier,
    codeChallenge,
    redirectUri,
    flowType: provider.flowType,
    fixedPort: provider.fixedPort,
    callbackPath: provider.callbackPath || "/callback",
  };
}

export async function exchangeTokens(providerName, code, redirectUri, codeVerifier, state, meta) {
  const provider = getProvider(providerName);
  const config = provider.prepareConfig
    ? await provider.prepareConfig(provider.config, meta || {})
    : provider.config;

  const tokens = await provider.exchangeToken(config, code, redirectUri, codeVerifier, state, meta || {});

  let extra = null;
  if (provider.postExchange) {
    extra = await provider.postExchange(tokens);
  }

  return provider.mapTokens(tokens, extra);
}

export async function requestDeviceCode(providerName, codeChallenge, options) {
  const provider = getProvider(providerName);
  if (provider.flowType !== "device_code") {
    throw new Error(`Provider ${providerName} does not support device code flow`);
  }
  return await provider.requestDeviceCode(provider.config, codeChallenge, options || {});
}

export async function pollForToken(providerName, deviceCode, codeVerifier, extraData) {
  const provider = getProvider(providerName);
  if (provider.flowType !== "device_code") {
    throw new Error(`Provider ${providerName} does not support device code flow`);
  }

  const result = await provider.pollToken(provider.config, deviceCode, codeVerifier, extraData);

  if (result.ok) {
    if (result.data.access_token) {
      let extra = null;
      if (provider.postExchange) {
        extra = await provider.postExchange(result.data);
      }
      const tokens = provider.mapTokens(result.data, extra);
      if (providerName === "kiro" && !tokens.providerSpecificData?.profileArn) {
        const profileArn = await fetchKiroProfileArn(tokens.accessToken);
        if (profileArn) tokens.providerSpecificData.profileArn = profileArn;
      }
      return { success: true, tokens };
    } else {
      if (result.data.error === 'authorization_pending' || result.data.error === 'slow_down') {
        return {
          success: false,
          error: result.data.error,
          errorDescription: result.data.error_description || result.data.message,
          pending: result.data.error === 'authorization_pending'
        };
      } else {
        return {
          success: false,
          error: result.data.error || 'no_access_token',
          errorDescription: result.data.error_description || result.data.message || 'No access token received'
        };
      }
    }
  }

  return { success: false, error: result.data.error, errorDescription: result.data.error_description };
}

let codexBackfillDone = false;

export async function backfillCodexEmails() {
  if (codexBackfillDone) return;
  codexBackfillDone = true;
  try {
    const { getProviderConnections, updateProviderConnection } = await import("@/lib/localDb");
    const connections = await getProviderConnections();
    const targets = connections.filter((c) => {
      if (c.provider !== "codex" || c.authType !== "oauth" || !c.idToken) return false;
      const hasEmail = !!c.email;
      const hasAccountInfo = !!c.providerSpecificData?.chatgptAccountId;
      return !hasEmail || !hasAccountInfo;
    });
    for (const conn of targets) {
      const info = extractCodexAccountInfo(conn.idToken);
      if (!info.email && !info.chatgptAccountId) continue;
      const patch = {};
      if (!conn.email && info.email) patch.email = info.email;
      if (info.chatgptAccountId || info.chatgptPlanType) {
        patch.providerSpecificData = {
          ...(conn.providerSpecificData || {}),
          chatgptAccountId: info.chatgptAccountId,
          chatgptPlanType: info.chatgptPlanType,
        };
      }
      if (Object.keys(patch).length) {
        await updateProviderConnection(conn.id, patch);
      }
    }
  } catch (err) {
    codexBackfillDone = false;
    console.log("backfillCodexEmails failed:", err?.message || err);
  }
}
