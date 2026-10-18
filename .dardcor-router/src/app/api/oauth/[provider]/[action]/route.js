import crypto from "crypto";
import { NextResponse } from "next/server";
import {
  getProvider,
  generateAuthData,
  exchangeTokens,
  requestDeviceCode,
  pollForToken
} from "@/lib/oauth/providers";
import { createProviderConnection, setProviderStatus } from "@/models";
import { readDesktopPassToken } from "open-sse/shared/mimoAccount.js";
import {
  startCodexProxy,
  stopCodexProxy,
  registerCodexSession,
  getCodexSessionStatus,
  clearCodexSession,
  startXaiProxy,
  stopXaiProxy,
  registerXaiSession,
  getXaiSessionStatus,
  clearXaiSession,
  startTraeProxy,
  stopTraeProxy,
  registerTraeSession,
  getTraeSessionStatus,
  clearTraeSession,
  startWindsurfProxy,
  stopWindsurfProxy,
  registerWindsurfSession,
  getWindsurfSessionStatus,
  clearWindsurfSession,
  startZedProxy,
  stopZedProxy,
  registerZedSession,
  getZedSessionStatus,
  clearZedSession,
  startXiaomiMimoProxy,
  stopXiaomiMimoProxy,
  registerXiaomiMimoSession,
  getXiaomiMimoSessionStatus,
  clearXiaomiMimoSession,
} from "@/lib/oauth/utils/server";
import { detectIdeInstalled } from "@/lib/oauth/utils/ideDetect";
import { ZED_HOSTED_CONFIG } from "@/lib/oauth/constants/oauth";

async function completeXaiManualCode(code, state) {
  const session = state ? getXaiSessionStatus(state) : null;
  if (!session) {
    throw new Error("xAI OAuth session not found; restart the login flow and paste the code again");
  }
  if (!code) throw new Error("Missing xAI authorization code");

  try {
    const tokenData = await exchangeTokens(
      "xai",
      code,
      session.redirectUri,
      session.codeVerifier,
      state
    );
    const connection = await createProviderConnection({
      provider: "xai",
      authType: "oauth",
      ...tokenData,
      expiresAt: tokenData.expiresIn
        ? new Date(Date.now() + tokenData.expiresIn * 1000).toISOString()
        : null,
      testStatus: "active",
    });
    clearXaiSession(state);
    stopXaiProxy();
    return {
      id: connection.id,
      provider: connection.provider,
      email: connection.email,
      displayName: connection.displayName,
    };
  } catch (err) {
    clearXaiSession(state);
    stopXaiProxy();
    throw err;
  }
}


export async function GET(request, { params }) {
  try {
    const { provider, action } = await params;
    const { searchParams } = new URL(request.url);

    if (action === "authorize") {
      if (provider === "xiaomi-mimo") {
        const { generateKeyPair, buildAuthorizeUrl, getKeyName } = await import("@/lib/oauth/providers/xiaomi-mimo");
        const { publicKey, privateKeyDer } = generateKeyPair();
        const state = searchParams.get("state") || crypto.randomUUID();

        const proxyResult = await startXiaomiMimoProxy();
        if (!proxyResult.success) {
          return NextResponse.json({ error: `Failed to start callback server: ${proxyResult.reason}` }, { status: 500 });
        }

        registerXiaomiMimoSession({ state, privateKeyDer });

        const redirectUri = proxyResult.callbackUrl;
        const authorizeUrl = buildAuthorizeUrl(publicKey, redirectUri, getKeyName());

        return NextResponse.json({
          state,
          authorizeUrl,
          redirectUri,
          port: proxyResult.port,
        });
      }

      const redirectUri = searchParams.get("redirect_uri") || "http://localhost:8080/callback";
      const reservedParams = new Set(["redirect_uri"]);
      const meta = {};
      searchParams.forEach((value, key) => { if (!reservedParams.has(key)) meta[key] = value; });
      if (provider === "zed") {
        try { const p = new URL(redirectUri).port; if (p) meta.nativeAppPort = p; } catch { }
      }
      const authData = await generateAuthData(provider, redirectUri, Object.keys(meta).length ? meta : undefined);
      return NextResponse.json(authData);
    }

    if (action === "start-proxy") {
      if (provider === "trae") {
        const result = await startTraeProxy();
        return NextResponse.json(result);
      }
      if (provider === "windsurf") {
        const result = await startWindsurfProxy();
        return NextResponse.json(result);
      }
      if (provider === "zed") {
        const result = await startZedProxy(searchParams.get("native_app_port") || ZED_HOSTED_CONFIG.defaultNativeAppPort);
        return NextResponse.json(result);
      }
      if (provider === "xiaomi-mimo") {
        const result = await startXiaomiMimoProxy();
        return NextResponse.json(result);
      }
      if (!["codex", "xai"].includes(provider)) {
        return NextResponse.json({ error: "Proxy only supported for codex/xai/trae/windsurf/zed" }, { status: 400 });
      }
      const appPort = searchParams.get("app_port");
      if (!appPort) {
        return NextResponse.json({ error: "Missing app_port" }, { status: 400 });
      }
      const state = searchParams.get("state");
      const codeVerifier = searchParams.get("code_verifier");
      const redirectUri = searchParams.get("redirect_uri");
      const result = provider === "xai"
        ? await startXaiProxy(Number(appPort))
        : await startCodexProxy(Number(appPort));
      let serverSide = false;
      if (result.success && state && codeVerifier && redirectUri) {
        serverSide = provider === "xai"
          ? registerXaiSession({ state, codeVerifier, redirectUri })
          : registerCodexSession({ state, codeVerifier, redirectUri });
      }
      return NextResponse.json({ ...result, serverSide });
    }

    if (action === "poll-status") {
      const state = searchParams.get("state");
      if (!state) {
        return NextResponse.json({ error: "Missing state" }, { status: 400 });
      }
      let session;
      if (provider === "trae") session = getTraeSessionStatus(state);
      else if (provider === "windsurf") session = getWindsurfSessionStatus(state);
      else if (provider === "zed") session = getZedSessionStatus(state);
      else if (provider === "xai") session = getXaiSessionStatus(state);
      else if (provider === "codex") session = getCodexSessionStatus(state);
      else if (provider === "xiaomi-mimo") session = getXiaomiMimoSessionStatus(state);
      else return NextResponse.json({ error: "Poll only supported for codex/xai/trae/windsurf/zed/xiaomi-mimo" }, { status: 400 });
      if (!session) return NextResponse.json({ status: "unknown" });
      if (session.status === "done" || session.status === "error") {
        const payload = { ...session };
        if (provider === "xiaomi-mimo") {
          if (session.status === "error") {
            clearXiaomiMimoSession(state);
            stopXiaomiMimoProxy();
          }
          return NextResponse.json(payload);
        }
        if (provider === "trae") clearTraeSession(state);
        else if (provider === "windsurf") clearWindsurfSession(state);
        else if (provider === "zed") clearZedSession(state);
        else if (provider === "xai") clearXaiSession(state);
        else clearCodexSession(state);
        return NextResponse.json(payload);
      }
      return NextResponse.json({ status: session.status });
    }

    if (action === "stop-proxy") {
      if (provider === "trae") stopTraeProxy();
      else if (provider === "windsurf") stopWindsurfProxy();
      else if (provider === "zed") stopZedProxy();
      else if (provider === "xai") stopXaiProxy();
      else if (provider === "codex") stopCodexProxy();
      else if (provider === "xiaomi-mimo") stopXiaomiMimoProxy();
      else return NextResponse.json({ error: "Proxy only supported for codex/xai/trae/windsurf/zed/xiaomi-mimo" }, { status: 400 });
      return NextResponse.json({ success: true });
    }

    if (action === "ide-status") {
      if (provider !== "trae" && provider !== "windsurf") {
        return NextResponse.json({ error: "ide-status only supported for trae/windsurf" }, { status: 400 });
      }
      const status = await detectIdeInstalled(provider);
      return NextResponse.json(status);
    }

    if (action === "device-code") {
      const providerData = getProvider(provider);
      if (providerData.flowType !== "device_code") {
        return NextResponse.json({ error: "Provider does not support device code flow" }, { status: 400 });
      }

      const authData = await generateAuthData(provider, null);
      const startUrl = searchParams.get("start_url");
      const region = searchParams.get("region");
      const authMethod = searchParams.get("auth_method");
      const deviceOptions = provider === "kiro"
        ? {
            ...(startUrl ? { startUrl } : {}),
            ...(region ? { region } : {}),
            ...(authMethod ? { authMethod } : {}),
          }
        : undefined;
      
      const noPkceDeviceProviders = [
        "github",
        "kiro",
        "kimi",
        "kimi-coding",
        "kilocode",
        "codebuddy-cn",
        "codebuddy-intl",
        "qoder",
        "grok-cli",
        "opencode",
      ];
      let deviceData;
      if (noPkceDeviceProviders.includes(provider)) {
        deviceData = await requestDeviceCode(provider, undefined, deviceOptions);
      } else {
        deviceData = await requestDeviceCode(provider, authData.codeChallenge, deviceOptions);
      }

      return NextResponse.json({
        ...deviceData,
        codeVerifier: deviceData.codeVerifier || authData.codeVerifier,
      });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.log("OAuth GET error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  try {
    const { provider, action } = await params;
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid or empty request body" }, { status: 400 });
    }

    if (action === "register-session") {
      const searchParams = new URL(request.url).searchParams;
      const state = searchParams.get("state") || body?.state;
      if (!state) return NextResponse.json({ error: "Missing state" }, { status: 400 });
      let ok = false;
      if (provider === "trae") ok = registerTraeSession({ state });
      else if (provider === "windsurf") ok = registerWindsurfSession({ state });
      else if (provider === "zed") ok = registerZedSession({ state, codeVerifier: body?.codeVerifier });
      else return NextResponse.json({ error: "register-session only supported for trae/windsurf/zed" }, { status: 400 });
      return NextResponse.json({ success: ok });
    }

    if (action === "exchange") {
      const { code, redirectUri, codeVerifier, state, meta } = body;

      if (provider === "xiaomi-mimo") {
        if (!state) {
          return NextResponse.json({ error: "Missing state" }, { status: 400 });
        }
        const session = getXiaomiMimoSessionStatus(state);
        if (!session || session.status !== "done" || !session.result) {
          return NextResponse.json(
            { error: session?.error || "OAuth session not completed. Please restart the login flow." },
            { status: 400 },
          );
        }
        const { uid, accessToken, baseUrl } = session.result;

        let passToken = null;
        try {
          passToken = await readDesktopPassToken();
        } catch {
        }

        try {
          const connection = await createProviderConnection({
            provider: "xiaomi-mimo",
            authType: "oauth",
            accessToken,
            refreshToken: null,
            expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
            email: uid ? `${uid}@xiaomi` : null,
            displayName: uid ? `Xiaomi ${uid}` : "Xiaomi MiMo",
            providerSpecificData: {
              uid: uid || null,
              baseUrl: baseUrl || "https://api.xiaomimimo.com/v1",
              authMethod: "oauth",
              mimoPassToken: passToken?.passToken || null,
              mimoUserId: passToken?.userId || null,
              mimoCUserId: passToken?.cUserId || null,
            },
            testStatus: "active",
          });
          clearXiaomiMimoSession(state);
          stopXiaomiMimoProxy();
          return NextResponse.json({
            success: true,
            connection: {
              id: connection.id,
              provider: connection.provider,
              email: connection.email,
              displayName: connection.displayName,
            },
          });
        } catch (err) {
          clearXiaomiMimoSession(state);
          stopXiaomiMimoProxy();
          return NextResponse.json({ error: err.message }, { status: 500 });
        }
      }

      if (provider === "trae" || provider === "windsurf") {
        const token = typeof code === "string" ? code.trim() : "";
        if (!token) {
          return NextResponse.json({ error: "Missing token or callback URL" }, { status: 400 });
        }
        try {
          const tokenData = await exchangeTokens(provider, token, null, null, state);
          const connection = await createProviderConnection({
            provider,
            authType: provider === "windsurf" ? "api_key" : "oauth",
            ...tokenData,
            expiresAt: tokenData.expiresIn
              ? new Date(Date.now() + tokenData.expiresIn * 1000).toISOString()
              : null,
            testStatus: "active",
          });
          return NextResponse.json({
            success: true,
            connection: {
              id: connection.id,
              provider: connection.provider,
              email: connection.email,
              displayName: connection.displayName,
            }
          });
        } catch (err) {
          return NextResponse.json({ error: err.message }, { status: 500 });
        }
      }

      if (code && code.startsWith("eyJ") && code.includes(".")) {
        const { extractCodexAccountInfo } = await import("@/lib/oauth/providers");
        const info = extractCodexAccountInfo(code);

        let directPayload = {};
        try {
          const b64 = code.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
          const padded = b64 + "=".repeat((4 - b64.length % 4) % 4);
          directPayload = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
        } catch {}

        const accountId = info.chatgptAccountId || directPayload.account_id;
        const planType = info.chatgptPlanType || directPayload.plan_type;
        const email = info.email || directPayload.email;

        const providerSpecificData = { authMethod: "access_token" };
        if (accountId) providerSpecificData.chatgptAccountId = accountId;
        if (planType) providerSpecificData.chatgptPlanType = planType;

        const connection = await createProviderConnection({
          provider,
          authType: "access_token",
          accessToken: code,
          email: email || null,
          providerSpecificData,
          testStatus: "active",
        });

        return NextResponse.json({
          success: true,
          connection: {
            id: connection.id,
            provider: connection.provider,
            email: connection.email,
            displayName: connection.displayName,
          }
        });
      }

      const noPkceExchangeProviders = ["cline", "clinepass", "kimchi"];
      if (!code || !redirectUri || (!codeVerifier && !noPkceExchangeProviders.includes(provider))) {
        return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
      }

      const tokenData = await exchangeTokens(provider, code, redirectUri, codeVerifier, state, meta);

      const connection = await createProviderConnection({
        provider,
        authType: "oauth",
        ...tokenData,
        expiresAt: tokenData.expiresIn 
          ? new Date(Date.now() + tokenData.expiresIn * 1000).toISOString() 
          : null,
        testStatus: "active",
      });

      await setProviderStatus(provider, true).catch(() => {});

      return NextResponse.json({ 
        success: true, 
        connection: {
          id: connection.id,
          provider: connection.provider,
          email: connection.email,
          displayName: connection.displayName,
        }
      });
    }

    if (action === "poll") {
      const { deviceCode, codeVerifier, extraData } = body;

      if (!deviceCode) {
        return NextResponse.json({ error: "Missing device code" }, { status: 400 });
      }

      const noPkceProviders = ["github", "kimi", "kimi-coding", "kilocode", "codebuddy-cn", "codebuddy-intl", "grok-cli", "opencode"];
      let result;
      if (noPkceProviders.includes(provider)) {
        result = await pollForToken(provider, deviceCode, null, extraData);
      } else if (provider === "kiro") {
        result = await pollForToken(provider, deviceCode, null, extraData);
      } else if (provider === "qoder") {
        if (!codeVerifier) {
          return NextResponse.json({ error: "Missing code verifier" }, { status: 400 });
        }
        result = await pollForToken(provider, deviceCode, codeVerifier, extraData);
      } else {
        if (!codeVerifier) {
          return NextResponse.json({ error: "Missing code verifier" }, { status: 400 });
        }
        result = await pollForToken(provider, deviceCode, codeVerifier);
      }

      if (result.success) {
        const providerId = provider === "kimi-coding" ? "kimi" : provider;
        const connection = await createProviderConnection({
          provider: providerId,
          authType: "oauth",
          ...result.tokens,
          expiresAt: result.tokens.expiresIn 
            ? new Date(Date.now() + result.tokens.expiresIn * 1000).toISOString() 
            : null,
          testStatus: "active",
        });

        await setProviderStatus(providerId, true).catch(() => {});

        return NextResponse.json({ 
          success: true, 
          connection: {
            id: connection.id,
            provider: connection.provider,
          }
        });
      }

      const isPending = result.pending || result.error === "authorization_pending" || result.error === "slow_down";
      
      return NextResponse.json({
        success: false,
        error: result.error,
        errorDescription: result.errorDescription,
        pending: isPending,
      });
    }

    if (action === "manual-code") {
      if (provider !== "xai") {
        return NextResponse.json({ error: "Manual code only supported for xai" }, { status: 400 });
      }
      const { code, state } = body;
      const connection = await completeXaiManualCode(String(code || "").trim(), String(state || "").trim());
      return NextResponse.json({ success: true, connection });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.log("OAuth POST error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
