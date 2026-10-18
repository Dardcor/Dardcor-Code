"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import PropTypes from "prop-types";
import { Modal, Button, Input } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

const PROXY_OAUTH_PROVIDERS = new Set(["trae", "windsurf", "zed"]);

const PASTE_TOKEN_PROVIDERS = {
  trae: {
    label: "Cloud-IDE-JWT",
    instructions:
      "Sign in at trae.ai (or solo.trae.ai), open DevTools → Network, copy the Cloud-IDE-JWT token from any request's Authorization header (~14-day lifetime).",
    placeholder: "Paste Cloud-IDE-JWT here...",
    ideName: "Trae",
    ideOptional: true,
  },
  windsurf: {
    label: "Windsurf API key",
    instructions:
      "In the Windsurf/VS Code IDE, run the \"Windsurf: Provide Auth Token\" command, then copy the displayed sk-ws-... key.",
    placeholder: "Paste sk-ws-... key here...",
    ideName: "Windsurf",
    ideOptional: false,
  },
};

export default function OAuthModal({ isOpen, provider, providerInfo, onSuccess, onClose, oauthMeta, idcConfig }) {
  const [step, setStep] = useState("waiting");
  const [authData, setAuthData] = useState(null);
  const [callbackUrl, setCallbackUrl] = useState("");
  const [error, setError] = useState(null);
  const [isDeviceCode, setIsDeviceCode] = useState(false);
  const [deviceData, setDeviceData] = useState(null);
  const [polling, setPolling] = useState(false);
  const [authMode, setAuthMode] = useState("browser");
  const [pasteToken, setPasteToken] = useState("");
  const [ideStatus, setIdeStatus] = useState(null);
  const popupRef = useRef(null);
  const pollingAbortRef = useRef(false);
  const openedRef = useRef(false);
  const { copied, copy } = useCopyToClipboard();

  const [isLocalhost, setIsLocalhost] = useState(false);
  const [placeholderUrl, setPlaceholderUrl] = useState("/callback?code=...");
  const callbackProcessedRef = useRef(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setIsLocalhost(
        window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
      );
      setPlaceholderUrl(`${window.location.origin}/callback?code=...`);
    }
  }, []);


  const exchangeTokens = useCallback(async (code, state) => {
    if (!authData) return;
    try {
      setStep("waiting");
      const res = await fetch(`/api/oauth/${provider}/exchange`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          redirectUri: authData.redirectUri,
          codeVerifier: authData.codeVerifier,
          state,
          ...(oauthMeta ? { meta: oauthMeta } : {}),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Token exchange failed");

      setStep("success");
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("providersChanged", { detail: { provider, connection: data.connection } }));
      }
      onSuccess?.();
    } catch (err) {
      setError(err.message);
      setStep("error");
    }
  }, [authData, provider, onSuccess, oauthMeta]);

  const completeXaiManualCode = useCallback(async (code) => {
    if (!authData?.state) return;
    try {
      const res = await fetch("/api/oauth/xai/manual-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, state: authData.state }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setStep("success");
      onSuccess?.();
    } catch (err) {
      setError(err.message);
      setStep("error");
    }
  }, [authData, onSuccess]);

  const startPolling = useCallback(async (deviceCode, codeVerifier, interval, extraData, deadlineMs) => {
    pollingAbortRef.current = false;
    setPolling(true);
    const startedAt = Date.now();
    const deadline = startedAt + (Number.isFinite(deadlineMs) && deadlineMs > 0 ? deadlineMs : 120_000);

    while (Date.now() < deadline) {
      if (pollingAbortRef.current) {
        console.log("[OAuthModal] Polling aborted");
        setPolling(false);
        return;
      }

      await new Promise((r) => setTimeout(r, interval * 1000));

      if (pollingAbortRef.current) {
        console.log("[OAuthModal] Polling aborted after sleep");
        setPolling(false);
        return;
      }

      try {
        const res = await fetch(`/api/oauth/${provider}/poll`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deviceCode, codeVerifier, extraData }),
        });

        const data = await res.json();

        if (data.success) {
          pollingAbortRef.current = true;
          setStep("success");
          setPolling(false);
          onSuccess?.();
          return;
        }

        if (data.error === "expired_token" || data.error === "access_denied") {
          throw new Error(data.errorDescription || data.error);
        }

        if (data.error === "slow_down") {
          interval = Math.min(interval + 5, 30);
        }
      } catch (err) {
        setError(err.message);
        setStep("error");
        setPolling(false);
        return;
      }
    }

    setError("Authorization timeout");
    setStep("error");
    setPolling(false);
  }, [provider, onSuccess]);

  const startProxyFlow = useCallback(async (providerId) => {
    const startRes = await fetch(`/api/oauth/${providerId}/start-proxy`);
    const startData = await startRes.json();
    if (!startRes.ok || !startData.success || !startData.callbackUrl) {
      throw new Error(startData.reason || startData.error || `Failed to start ${providerId} callback server`);
    }
    const authorizeUrl = new URL(`/api/oauth/${providerId}/authorize`, window.location.origin);
    authorizeUrl.searchParams.set("redirect_uri", startData.callbackUrl);
    const authRes = await fetch(authorizeUrl);
    const authData = await authRes.json();
    if (!authRes.ok) throw new Error(authData.error);
    const regBody = { state: authData.state };
    if (authData.codeVerifier) regBody.codeVerifier = authData.codeVerifier;
    await fetch(`/api/oauth/${providerId}/register-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(regBody),
    });
    setAuthData({ ...authData, proxyProvider: providerId });
    setStep("waiting");
    popupRef.current = window.open(authData.authUrl, "oauth_popup", "width=600,height=700");
    if (!popupRef.current) setStep("input");
  }, []);

  const startOAuthFlow = useCallback(async () => {
    if (!provider) return;
    try {
      setError(null);

      if (PROXY_OAUTH_PROVIDERS.has(provider) && authMode === "browser") {
        await startProxyFlow(provider);
        return;
      }

      const deviceCodeProviders = [
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
      if (deviceCodeProviders.includes(provider)) {
        setIsDeviceCode(true);
        setStep("waiting");

        const deviceCodeUrl = new URL(`/api/oauth/${provider}/device-code`, window.location.origin);
        if (provider === "kiro" && idcConfig?.startUrl) {
          deviceCodeUrl.searchParams.set("start_url", idcConfig.startUrl);
          if (idcConfig.region) {
            deviceCodeUrl.searchParams.set("region", idcConfig.region);
          }
          deviceCodeUrl.searchParams.set("auth_method", "idc");
        }
        const res = await fetch(deviceCodeUrl.toString());
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        setDeviceData(data);

        const verifyUrl = data.verification_uri_complete || data.verification_uri;
        if (verifyUrl) window.open(verifyUrl, "_blank", "noopener,noreferrer");

        const extraData = provider === "kiro"
          ? {
              _clientId: data._clientId,
              _clientSecret: data._clientSecret,
              _region: data._region,
              _authMethod: data._authMethod,
              _startUrl: data._startUrl,
            }
          : provider === "qoder"
          ? {
              _qoderNonce: data._qoderNonce,
              _qoderMachineId: data._qoderMachineId,
              _qoderVerifier: data.codeVerifier,
            }
          : (provider === "kimi" || provider === "kimi-coding")
          ? { _kimiDeviceId: data._kimiDeviceId }
          : null;
        startPolling(
          data.device_code,
          data.codeVerifier,
          data.interval || 5,
          extraData,
          Number.isFinite(data.expires_in) && data.expires_in > 0
            ? data.expires_in * 1000
            : undefined,
        );
        return;
      }

      const appPort = window.location.port || (window.location.protocol === "https:" ? "443" : "80");
      let redirectUri;
      if (provider === "codex") {
        redirectUri = "http://localhost:1455/auth/callback";
      } else if (provider === "xai") {
        redirectUri = "http://127.0.0.1:56121/callback";
      } else {
        redirectUri = `${window.location.origin}/callback`;
      }

      const authorizeUrl = new URL(`/api/oauth/${provider}/authorize`, window.location.origin);
      authorizeUrl.searchParams.set("redirect_uri", redirectUri);
      if (oauthMeta) {
        Object.entries(oauthMeta).forEach(([k, v]) => { if (v) authorizeUrl.searchParams.set(k, v); });
      }
      const res = await fetch(authorizeUrl.toString());
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      let codexProxyActive = false;
      let codexServerSide = false;
      if (provider === "codex") {
        try {
          const proxyUrl = new URL(`/api/oauth/codex/start-proxy`, window.location.origin);
          proxyUrl.searchParams.set("app_port", appPort);
          proxyUrl.searchParams.set("state", data.state);
          proxyUrl.searchParams.set("code_verifier", data.codeVerifier);
          proxyUrl.searchParams.set("redirect_uri", redirectUri);
          const proxyRes = await fetch(proxyUrl.toString());
          const proxyData = await proxyRes.json();
          codexProxyActive = proxyData.success;
          codexServerSide = !!proxyData.serverSide;
        } catch {
          codexProxyActive = false;
        }
      }

      let xaiProxyActive = false;
      let xaiServerSide = false;
      if (provider === "xai") {
        try {
          const proxyUrl = new URL(`/api/oauth/xai/start-proxy`, window.location.origin);
          proxyUrl.searchParams.set("app_port", appPort);
          proxyUrl.searchParams.set("state", data.state);
          proxyUrl.searchParams.set("code_verifier", data.codeVerifier);
          proxyUrl.searchParams.set("redirect_uri", redirectUri);
          const proxyRes = await fetch(proxyUrl.toString());
          const proxyData = await proxyRes.json();
          xaiProxyActive = proxyData.success;
          xaiServerSide = !!proxyData.serverSide;
          if (!xaiProxyActive && proxyData.reason === "port_busy") {
            throw new Error("Port 56121 in use; close the conflicting process and retry");
          }
        } catch (e) {
          if (e?.message) throw e;
          xaiProxyActive = false;
        }
      }

      setAuthData({ ...data, redirectUri, codexServerSide, xaiServerSide });

      if (!data.authUrl) {
        if (data.flowType === "device_code") {
          throw new Error(
            `Provider ${provider} uses device-code login but is not wired in the OAuth modal device-code list`
          );
        }
        throw new Error("No authorization URL returned from OAuth provider");
      }

      if (provider === "codex" && codexProxyActive) {
        setStep("waiting");
        popupRef.current = window.open(data.authUrl, "oauth_popup", "width=600,height=700");
        if (!popupRef.current) {
          setStep("input");
        }
      } else if (provider === "xai" && xaiProxyActive) {
        setStep("waiting");
        popupRef.current = window.open(data.authUrl, "oauth_popup", "width=600,height=700");
        if (!popupRef.current) {
          setStep("input");
        }
      } else if (!isLocalhost || provider === "codex" || provider === "xai") {
        setStep("input");
        window.open(data.authUrl, "_blank");
      } else {
        setStep("waiting");
        popupRef.current = window.open(data.authUrl, "oauth_popup", "width=600,height=700");
        if (!popupRef.current) {
          setStep("input");
        }
      }
    } catch (err) {
      setError(err.message);
      setStep("error");
    }
  }, [provider, isLocalhost, startPolling, oauthMeta, idcConfig, authMode, startProxyFlow]);

  useEffect(() => {
    if (isOpen && provider) {
      if (openedRef.current) return;
      openedRef.current = true;
      setAuthData(null);
      setCallbackUrl("");
      setError(null);
      setIsDeviceCode(false);
      setDeviceData(null);
      setPolling(false);
      setAuthMode("browser");
      setPasteToken("");
      setIdeStatus(null);
      pollingAbortRef.current = false;
      if (PASTE_TOKEN_PROVIDERS[provider]) {
        fetch(`/api/oauth/${provider}/ide-status`)
          .then((r) => r.json())
          .then((data) => setIdeStatus(data))
          .catch(() => setIdeStatus({ installed: false, path: null }));
      }
      startOAuthFlow();
    } else if (!isOpen) {
      pollingAbortRef.current = true;
      openedRef.current = false;
      if (provider === "codex") {
        fetch("/api/oauth/codex/stop-proxy").catch(() => {});
      } else if (provider === "xai") {
        fetch("/api/oauth/xai/stop-proxy").catch(() => {});
      } else if (provider === "trae") {
        fetch("/api/oauth/trae/stop-proxy").catch(() => {});
      } else if (provider === "windsurf") {
        fetch("/api/oauth/windsurf/stop-proxy").catch(() => {});
      } else if (provider === "zed") {
        fetch("/api/oauth/zed/stop-proxy").catch(() => {});
      }
    }
  }, [isOpen, provider, startOAuthFlow]);

  useEffect(() => {
    const pollProvider = authData?.codexServerSide
      ? "codex"
      : authData?.xaiServerSide
        ? "xai"
        : authData?.proxyProvider
          ? authData.proxyProvider
          : null;
    if (!pollProvider || !authData?.state) return;
    if (callbackProcessedRef.current) return;
    let cancelled = false;
    const POLL_INTERVAL_MS = 1500;
    const MAX_ATTEMPTS = 200;
    let attempts = 0;

    const tick = async () => {
      if (cancelled || callbackProcessedRef.current) return;
      attempts += 1;
      try {
          const res = await fetch(`/api/oauth/${pollProvider}/poll-status?state=${encodeURIComponent(authData.state)}`);
        const data = await res.json();
        if (cancelled || callbackProcessedRef.current) return;
        if (data.status === "done") {
          callbackProcessedRef.current = true;
          setStep("success");
          onSuccess?.();
          return;
        }
        if (data.status === "error") {
          callbackProcessedRef.current = true;
          setError(data.error || "Authentication failed");
          setStep("error");
          return;
        }
      } catch {
      }
      if (attempts >= MAX_ATTEMPTS) {
        callbackProcessedRef.current = true;
        setError("Authentication timeout");
        setStep("error");
        return;
      }
      setTimeout(tick, POLL_INTERVAL_MS);
    };
    setTimeout(tick, POLL_INTERVAL_MS);
    return () => { cancelled = true; };
  }, [authData, onSuccess]);

  useEffect(() => {
    if (!authData) return;
    callbackProcessedRef.current = false;

    const handleCallback = async (data) => {
      if (callbackProcessedRef.current) return;

      const { code, token, state, error: callbackError, errorDescription, fullUrl } = data || {};

      if (fullUrl) {
        setCallbackUrl(fullUrl);
      } else if (code) {
        setCallbackUrl(`http://127.0.0.1:25128/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state || "")}`);
      }

      if (callbackError) {
        callbackProcessedRef.current = true;
        setError(errorDescription || callbackError);
        setStep("error");
        return;
      }

      if (token || code) {
        callbackProcessedRef.current = true;
        setStep("waiting");
        await exchangeTokens(token || code, state || authData?.state);
      }
    };

    const handleMessage = (event) => {
      const isLoopback = !event.origin || event.origin.includes("localhost") || event.origin.includes("127.0.0.1") || event.origin === window.location.origin;
      if (!isLoopback) return;

      if (event.data?.type === "oauth_callback" && event.data?.data) {
        handleCallback(event.data.data);
      }
    };
    window.addEventListener("message", handleMessage);

    let channel;
    try {
      channel = new BroadcastChannel("oauth_callback");
      channel.onmessage = (event) => {
        if (event.data) handleCallback(event.data);
      };
    } catch (e) {
      console.log("BroadcastChannel not supported");
    }

    const handleStorage = (event) => {
      if (event.key === "oauth_callback" && event.newValue) {
        try {
          const data = JSON.parse(event.newValue);
          handleCallback(data);
          localStorage.removeItem("oauth_callback");
        } catch (e) {
          console.log("Failed to parse localStorage data");
        }
      }
    };
    window.addEventListener("storage", handleStorage);

    let active = true;
    const pollInterval = setInterval(async () => {
      if (!active || callbackProcessedRef.current) return;

      try {
        const query = authData?.state ? `?state=${encodeURIComponent(authData.state)}` : "";
        const res = await fetch(`/api/oauth/callback-relay${query}`);
        if (res.ok) {
          const json = await res.json();
          if (json.success && json.data) {
            handleCallback(json.data);
            return;
          }
        }
      } catch {
      }

      if (popupRef.current && !popupRef.current.closed) {
        try {
          const href = popupRef.current.location.href;
          if (href && href.includes("/callback")) {
            const url = new URL(href);
            const code = url.searchParams.get("code");
            const token = url.searchParams.get("token");
            const state = url.searchParams.get("state");
            const error = url.searchParams.get("error");
            if (code || token || error) {
              handleCallback({ code, token, state, error, fullUrl: href });
              try { popupRef.current.close(); } catch {}
              return;
            }
          }
        } catch {
        }
      }

      try {
        const stored = localStorage.getItem("oauth_callback");
        if (stored) {
          const data = JSON.parse(stored);
          if (data.timestamp && Date.now() - data.timestamp < 30000) {
            handleCallback(data);
          }
          localStorage.removeItem("oauth_callback");
        }
      } catch {}
    }, 1000);

    return () => {
      active = false;
      clearInterval(pollInterval);
      window.removeEventListener("message", handleMessage);
      window.removeEventListener("storage", handleStorage);
      if (channel) channel.close();
    };
  }, [authData, exchangeTokens]);

  const handleManualSubmit = async () => {
    try {
      setError(null);

      if (authMode === "paste-token" && PASTE_TOKEN_PROVIDERS[provider]) {
        const token = pasteToken.trim();
        if (!token) throw new Error("Missing token");
        const res = await fetch(`/api/oauth/${provider}/exchange`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: token }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setStep("success");
        onSuccess?.();
        return;
      }

      const input = callbackUrl.trim();

      if (PROXY_OAUTH_PROVIDERS.has(provider) && input) {
        const res = await fetch(`/api/oauth/${provider}/exchange`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: input, state: authData?.state }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setStep("success");
        onSuccess?.();
        return;
      }

      if (input.startsWith("eyJ") && input.includes(".")) {
        await exchangeTokens(input, null);
        return;
      }

      if (provider === "xai" && input && !input.includes("://") && !input.includes("?") && !input.includes("code=")) {
        await completeXaiManualCode(input);
        return;
      }

      if (provider === "kimchi" && input && !input.includes("://") && !input.includes("?")) {
        await exchangeTokens(input, null);
        return;
      }

      let code = null;
      let token = null;
      let state = null;
      let errorParam = null;

      try {
        const urlStr = input.startsWith("http://") || input.startsWith("https://")
          ? input
          : `http://localhost:25128/${input.replace(/^\/?/, "")}`;
        const url = new URL(urlStr);
        code = url.searchParams.get("code");
        token = url.searchParams.get("token");
        state = url.searchParams.get("state");
        errorParam = url.searchParams.get("error");
        if (errorParam) {
          throw new Error(url.searchParams.get("error_description") || errorParam);
        }
      } catch (parseErr) {
        if (errorParam) throw parseErr;
        const codeMatch = input.match(/[?&]?code=([^&\s]+)/);
        const tokenMatch = input.match(/[?&]?token=([^&\s]+)/);
        const stateMatch = input.match(/[?&]?state=([^&\s]+)/);
        code = codeMatch ? decodeURIComponent(codeMatch[1]) : (input.includes("/") ? null : input);
        token = tokenMatch ? decodeURIComponent(tokenMatch[1]) : null;
        state = stateMatch ? decodeURIComponent(stateMatch[1]) : null;
      }

      if (!code && !token) {
        throw new Error(
          provider === "xai"
            ? "Paste the callback URL or copied xAI code"
            : provider === "kimchi"
              ? "No Kimchi token found in URL"
              : "No authorization code found in URL"
        );
      }

      await exchangeTokens(token || code, state || authData?.state);
    } catch (err) {
      setError(err.message);
      setStep("error");
    }
  };

  useEffect(() => {
    const trimmed = callbackUrl.trim();
    if (!trimmed || callbackProcessedRef.current) return;
    if (trimmed.includes("code=") || trimmed.includes("token=") || (trimmed.startsWith("eyJ") && trimmed.includes("."))) {
      const timer = setTimeout(() => {
        handleManualSubmit();
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [callbackUrl]);

  const handleClose = useCallback(() => {
    if (provider === "codex") {
      fetch("/api/oauth/codex/stop-proxy").catch(() => {});
    } else if (provider === "xai") {
      fetch("/api/oauth/xai/stop-proxy").catch(() => {});
    } else if (provider === "trae") {
      fetch("/api/oauth/trae/stop-proxy").catch(() => {});
    } else if (provider === "windsurf") {
      fetch("/api/oauth/windsurf/stop-proxy").catch(() => {});
    } else if (provider === "zed") {
      fetch("/api/oauth/zed/stop-proxy").catch(() => {});
    }
    onClose();
  }, [onClose, provider]);

  if (!provider || !providerInfo) return null;
  const isXaiProvider = provider === "xai";
  const isKimchiProvider = provider === "kimchi";
  const deviceLoginUrl = deviceData?.verification_uri_complete || deviceData?.verification_uri || "";
  const modalTitle = isXaiProvider ? "Connect Grok Build OAuth" : `Connect ${providerInfo.name}`;
  const manualPlaceholder = isXaiProvider
    ? "http://127.0.0.1:56121/callback?code=... or copied code"
    : isKimchiProvider
      ? `${placeholderUrl.replace("code=...", "token=...")} or copied token`
      : placeholderUrl;

  return (
    <Modal isOpen={isOpen} title={modalTitle} onClose={handleClose} size="lg">
      <div className="flex flex-col gap-4">
        {}
        {PROXY_OAUTH_PROVIDERS.has(provider) && (step === "waiting" || step === "input" || step === "error") && (
          <>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setAuthMode("browser"); setError(null); setStep("waiting"); startOAuthFlow(); }}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${authMode === "browser" ? "border-primary bg-primary/10 text-primary" : "border-border text-text-muted hover:text-primary"}`}
              >
                🌐 Sign in with browser
              </button>
              <button
                type="button"
                onClick={() => { setAuthMode("paste-token"); setError(null); setStep("input"); }}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${authMode === "paste-token" ? "border-primary bg-primary/10 text-primary" : "border-border text-text-muted hover:text-primary"}`}
              >
                🔑 Paste token
              </button>
            </div>

            {authMode === "browser" && (
              <>
                {step === "waiting" && (
                  <div className="flex items-center gap-2 px-3 py-2 border border-border rounded-lg bg-sidebar/50">
                    <span className="material-symbols-outlined text-base text-primary animate-spin">progress_activity</span>
                    <span className="text-sm">Waiting for browser authorization…</span>
                  </div>
                )}
                {step === "input" && (
                  <div className="space-y-3">
                    <p className="text-sm text-text-muted">
                      Popup was blocked. After authorizing in the browser, paste the full callback URL here:
                    </p>
                    <Input
                      value={callbackUrl}
                      onChange={(e) => setCallbackUrl(e.target.value)}
                      placeholder="http://127.0.0.1:.../callback?..."
                      className="font-mono text-xs"
                    />
                    <div className="flex gap-2">
                      <Button onClick={handleManualSubmit} fullWidth disabled={!callbackUrl}>Connect</Button>
                      <Button onClick={handleClose} variant="ghost" fullWidth>Cancel</Button>
                    </div>
                  </div>
                )}
              </>
            )}

            {authMode === "paste-token" && (
              <div className="space-y-3">
                {ideStatus && !ideStatus.installed && (
                  <div className={`px-3 py-2 rounded-lg text-sm ${PASTE_TOKEN_PROVIDERS[provider].ideOptional ? "bg-blue-500/10 text-blue-700 dark:text-blue-300" : "bg-yellow-500/10 text-yellow-700 dark:text-yellow-300"}`}>
                    {PASTE_TOKEN_PROVIDERS[provider].ideName} IDE not detected.
                    {PASTE_TOKEN_PROVIDERS[provider].ideOptional
                      ? " You can still grab the token from DevTools."
                      : ` Install ${PASTE_TOKEN_PROVIDERS[provider].ideName} IDE to get the token, or use "Sign in with browser".`}
                  </div>
                )}
                <p className="text-sm text-text-muted">{PASTE_TOKEN_PROVIDERS[provider].instructions}</p>
                <Input
                  value={pasteToken}
                  onChange={(e) => setPasteToken(e.target.value)}
                  placeholder={PASTE_TOKEN_PROVIDERS[provider].placeholder}
                  className="font-mono text-xs"
                />
                <div className="flex gap-2">
                  <Button onClick={handleManualSubmit} fullWidth disabled={!pasteToken}>Connect</Button>
                  <Button onClick={handleClose} variant="ghost" fullWidth>Cancel</Button>
                </div>
              </div>
            )}
          </>
        )}

        {}
        {(step === "waiting" || step === "input") && !isDeviceCode && !PROXY_OAUTH_PROVIDERS.has(provider) && (
          <>
            {}
            <div className="flex items-center gap-2 px-3 py-2 border border-border rounded-lg bg-sidebar/50">
              <span className="material-symbols-outlined text-base text-primary animate-spin">
                progress_activity
              </span>
              <span className="text-sm">
                {isXaiProvider ? "Waiting for Grok Build OAuth…" : "Waiting for popup authorization…"}
              </span>
            </div>

            {}
            <div className="flex items-center gap-3 my-1">
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs text-text-muted uppercase tracking-wider">Or paste callback URL manually</span>
              <div className="flex-1 h-px bg-border" />
            </div>

            {}
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium mb-2">
                  Step 1: Open this {isXaiProvider ? "Grok Build OAuth URL" : "URL"} in your browser
                </p>
                <div className="flex gap-2">
                  <Input value={authData?.authUrl || ""} readOnly className="flex-1 font-mono text-xs" />
                  <Button variant="secondary" icon={copied === "auth_url" ? "check" : "content_copy"} onClick={() => copy(authData?.authUrl, "auth_url")} disabled={!authData?.authUrl}>
                    Copy
                  </Button>
                </div>
              </div>

              <div>
                <p className="text-sm font-medium mb-2">
                  Step 2: Paste the {provider === "xai" ? "callback URL or copied code" : isKimchiProvider ? "callback URL or copied token" : "callback URL"} here
                </p>
                <p className="text-xs text-text-muted mb-2">
                  {provider === "xai"
                    ? "If xAI shows a code instead of redirecting, paste that code here."
                    : isKimchiProvider
                      ? "After authorization, copy the full callback URL or token from your browser."
                    : "After authorization, copy the full URL from your browser."}
                </p>
                <Input
                  value={callbackUrl}
                  onChange={(e) => setCallbackUrl(e.target.value)}
                  placeholder={manualPlaceholder}
                  className="font-mono text-xs"
                />
              </div>
            </div>

            <div className="flex gap-2">
              <Button onClick={handleManualSubmit} fullWidth disabled={!callbackUrl}>
                Connect
              </Button>
              <Button onClick={handleClose} variant="ghost" fullWidth>
                Cancel
              </Button>
            </div>
          </>
        )}

        {}
        {step === "waiting" && isDeviceCode && deviceData && (
          <>
            <div className="text-center py-4">
              <p className="text-sm text-text-muted mb-4">
                Visit the login URL below and authorize:
              </p>
              <div className="bg-sidebar p-4 rounded-lg mb-4">
                <p className="text-xs text-text-muted mb-1">Login URL</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-sm break-all">{deviceLoginUrl}</code>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={copied === "login_url" ? "check" : "content_copy"}
                    onClick={() => copy(deviceLoginUrl, "login_url")}
                    disabled={!deviceLoginUrl}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="open_in_new"
                    onClick={() => window.open(deviceLoginUrl, "_blank", "noopener,noreferrer")}
                    disabled={!deviceLoginUrl}
                  >
                    Open
                  </Button>
                </div>
              </div>
              <div className="bg-primary/10 p-4 rounded-lg">
                <p className="text-xs text-text-muted mb-1">Your Code</p>
                <div className="flex items-center justify-center gap-2">
                  <p className="text-2xl font-mono font-bold text-primary">{deviceData.user_code}</p>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={copied === "user_code" ? "check" : "content_copy"}
                    onClick={() => copy(deviceData.user_code, "user_code")}
                  />
                </div>
              </div>
            </div>
            {polling && (
              <div className="flex items-center justify-center gap-2 text-sm text-text-muted">
                <span className="material-symbols-outlined animate-spin">progress_activity</span>
                Waiting for authorization...
              </div>
            )}
          </>
        )}

        {}
        {step === "success" && (
          <div className="text-center py-6">
            <div className="size-16 mx-auto mb-4 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-green-600">check_circle</span>
            </div>
            <h3 className="text-lg font-semibold mb-2">Connected Successfully!</h3>
            <p className="text-sm text-text-muted mb-4">
              Your {providerInfo.name} account has been connected.
            </p>
            <Button onClick={handleClose} fullWidth>
              Done
            </Button>
          </div>
        )}

        {}
        {step === "error" && (
          <div className="text-center py-6">
            <div className="size-16 mx-auto mb-4 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-red-600">error</span>
            </div>
            <h3 className="text-lg font-semibold mb-2">Connection Failed</h3>
            <p className="text-sm text-red-600 mb-4">{error}</p>
            <div className="flex gap-2">
              <Button onClick={startOAuthFlow} variant="secondary" fullWidth>
                Try Again
              </Button>
              <Button onClick={handleClose} variant="ghost" fullWidth>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

OAuthModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  provider: PropTypes.string,
  providerInfo: PropTypes.shape({ name: PropTypes.string }),
  onSuccess: PropTypes.func,
  onClose: PropTypes.func.isRequired,
  oauthMeta: PropTypes.object,
  idcConfig: PropTypes.shape({
    startUrl: PropTypes.string,
    region: PropTypes.string,
  }),
};
