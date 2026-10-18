import http from "http";
import { URL } from "url";
import { CODEX_CONFIG, TRAE_CONFIG, WINDSURF_CONFIG, ZED_HOSTED_CONFIG } from "../constants/oauth.js";

function isLoopbackOrigin(origin) {
  if (!origin) return true;
  return /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);
}


export function startLocalServer(onCallback, fixedPort = null) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://localhost`);

      if (url.pathname === "/callback" || url.pathname === "/auth/callback") {
        const params = Object.fromEntries(url.searchParams);

        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Authentication Successful</title>
  <style>
    body { font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f5f5f5; }
    .container { text-align: center; padding: 2rem; background: white; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .success { color: #22c55e; font-size: 3rem; }
    h1 { margin: 1rem 0; }
    p { color: #666; }
    #countdown { font-weight: bold; }
  </style>
</head>
<body>
  <div class="container">
    <div class="success">&#10003;</div>
    <h1>Authentication Successful</h1>
    <p id="message">Closing in <span id="countdown">3</span> seconds...</p>
  </div>
  <script>
    let count = 3;
    const countdown = document.getElementById("countdown");
    const message = document.getElementById("message");
    const timer = setInterval(() => {
      count--;
      countdown.textContent = count;
      if (count <= 0) {
        clearInterval(timer);
        window.close();
        setTimeout(() => {
          message.textContent = "Please close this tab manually.";
        }, 500);
      }
    }, 1000);
  </script>
</body>
</html>`);

        onCallback(params);
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });

    const portToUse = fixedPort || 0;
    server.listen(portToUse, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        server,
        port,
        close: () => server.close(),
      });
    });

    server.on("error", (err) => {
      if (err.code === "EADDRINUSE" && fixedPort) {
        reject(new Error(`Port ${fixedPort} is already in use. Please close other applications using this port.`));
      } else {
        reject(err);
      }
    });
  });
}

export function waitForCallback(timeoutMs = 300000) {
  return new Promise((resolve, reject) => {
    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        reject(new Error("Authentication timeout"));
      }
    }, timeoutMs);

    const onCallback = (params) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve(params);
      }
    };

    resolve.__onCallback = onCallback;
  });
}

let codexProxyServer = null;
let codexProxyTimeout = null;

const CODEX_PROXY_TIMEOUT_MS = 300000;
const CODEX_PORT = CODEX_CONFIG.fixedPort;

const pendingExchanges = new Map();

export function registerCodexSession({ state, codeVerifier, redirectUri }) {
  if (!state || !codeVerifier || !redirectUri) return false;
  pendingExchanges.set(state, {
    codeVerifier,
    redirectUri,
    status: "pending",
    createdAt: Date.now(),
  });
  return true;
}

export function getCodexSessionStatus(state) {
  return pendingExchanges.get(state) || null;
}

export function clearCodexSession(state) {
  pendingExchanges.delete(state);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderCodexResultPage(success, message) {
  const color = success ? "#22c55e" : "#ef4444";
  const icon = success ? "&#10003;" : "&#10007;";
  const title = success ? "Authentication Successful" : "Authentication Failed";
  const safeMessage = escapeHtml(message);
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#f5f5f5}.c{text-align:center;padding:2rem;background:#fff;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.1)}.i{color:${color};font-size:3rem}h1{margin:1rem 0}p{color:#666}</style>
</head><body><div class="c"><div class="i">${icon}</div><h1>${title}</h1><p>${safeMessage}</p><p>Closing in <span id="cd">3</span>s...</p>
<script>let n=3;const c=document.getElementById("cd");const t=setInterval(()=>{n--;c.textContent=n;if(n<=0){clearInterval(t);window.close();}},1000);</script>
</div></body></html>`;
}

export function startCodexProxy(appPort) {
  return new Promise((resolve) => {
    if (codexProxyServer) {
      resolve({ success: true });
      return;
    }

    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, "http://localhost");

      if (url.pathname !== "/callback" && url.pathname !== "/auth/callback") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const errorParam = url.searchParams.get("error");
      const session = state ? pendingExchanges.get(state) : null;

      if (session) {
        try {
          if (errorParam) {
            throw new Error(url.searchParams.get("error_description") || errorParam);
          }
          if (!code) throw new Error("No authorization code received");

          const { exchangeTokens } = await import("../providers.js");
          const { createProviderConnection } = await import("@/models");

          const tokenData = await exchangeTokens(
            "codex",
            code,
            session.redirectUri,
            session.codeVerifier,
            state
          );
          const connection = await createProviderConnection({
            provider: "codex",
            authType: "oauth",
            ...tokenData,
            expiresAt: tokenData.expiresIn
              ? new Date(Date.now() + tokenData.expiresIn * 1000).toISOString()
              : null,
            testStatus: "active",
          });

          session.status = "done";
          session.connectionId = connection.id;
          session.email = connection.email;

          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(renderCodexResultPage(true, "You can close this window."));
        } catch (err) {
          session.status = "error";
          session.error = err.message;
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(renderCodexResultPage(false, err.message));
        } finally {
          stopCodexProxy();
        }
        return;
      }

      const redirectUrl = `http://localhost:${appPort}/callback${url.search}`;
      res.writeHead(302, { Location: redirectUrl });
      res.end();
      stopCodexProxy();
    });

    server.listen(CODEX_PORT, "127.0.0.1", () => {
      codexProxyServer = server;
      codexProxyTimeout = setTimeout(() => stopCodexProxy(), CODEX_PROXY_TIMEOUT_MS);
      resolve({ success: true });
    });

    server.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        resolve({ success: false, reason: "port_busy" });
      } else {
        resolve({ success: false, reason: err.message });
      }
    });
  });
}

export function stopCodexProxy() {
  if (codexProxyTimeout) {
    clearTimeout(codexProxyTimeout);
    codexProxyTimeout = null;
  }
  if (codexProxyServer) {
    codexProxyServer.close();
    codexProxyServer = null;
  }
}


let xaiProxyServer = null;
let xaiProxyTimeout = null;
const XAI_PROXY_TIMEOUT_MS = 300000;
const XAI_PROXY_PORT = 56121;
const xaiPendingExchanges = new Map();

export function registerXaiSession({ state, codeVerifier, redirectUri }) {
  if (!state || !codeVerifier || !redirectUri) return false;
  xaiPendingExchanges.set(state, {
    codeVerifier,
    redirectUri,
    status: "pending",
    createdAt: Date.now(),
  });
  return true;
}

export function getXaiSessionStatus(state) {
  return xaiPendingExchanges.get(state) || null;
}

export function clearXaiSession(state) {
  xaiPendingExchanges.delete(state);
}

function renderXaiResultPage(success, message) {
  return renderCodexResultPage(success, message);
}

export function startXaiProxy(appPort) {
  return new Promise((resolve) => {
    if (xaiProxyServer) {
      resolve({ success: true });
      return;
    }

    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname !== "/callback" && url.pathname !== "/auth/callback") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const errorParam = url.searchParams.get("error");
      const session = state ? xaiPendingExchanges.get(state) : null;

      if (session) {
        try {
          if (errorParam) {
            throw new Error(url.searchParams.get("error_description") || errorParam);
          }
          if (!code) throw new Error("No authorization code received");

          const { exchangeTokens } = await import("../providers.js");
          const { createProviderConnection } = await import("@/models");

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

          session.status = "done";
          session.connectionId = connection.id;
          session.email = connection.email;

          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(renderXaiResultPage(true, "You can close this window."));
        } catch (err) {
          session.status = "error";
          session.error = err.message;
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(renderXaiResultPage(false, err.message));
        } finally {
          stopXaiProxy();
        }
        return;
      }

      const redirectUrl = `http://localhost:${appPort}/callback${url.search}`;
      res.writeHead(302, { Location: redirectUrl });
      res.end();
      stopXaiProxy();
    });

    server.listen(XAI_PROXY_PORT, "127.0.0.1", () => {
      xaiProxyServer = server;
      xaiProxyTimeout = setTimeout(() => stopXaiProxy(), XAI_PROXY_TIMEOUT_MS);
      resolve({ success: true });
    });

    server.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        resolve({ success: false, reason: "port_busy" });
      } else {
        resolve({ success: false, reason: err.message });
      }
    });
  });
}

export function stopXaiProxy() {
  if (xaiProxyTimeout) {
    clearTimeout(xaiProxyTimeout);
    xaiProxyTimeout = null;
  }
  if (xaiProxyServer) {
    xaiProxyServer.close();
    xaiProxyServer = null;
  }
}


let traeProxyServer = null;
let traeProxyTimeout = null;
let traeProxyPort = null;
let traeSession = null;

export function registerTraeSession({ state }) {
  if (!state) return false;
  traeSession = { state, status: "pending", createdAt: Date.now() };
  return true;
}
export function getTraeSessionStatus(state) {
  if (!traeSession) return null;
  if (state && traeSession.state !== state) return null;
  return traeSession;
}
export function clearTraeSession(state) {
  if (!state || (traeSession && traeSession.state === state)) traeSession = null;
}

export function startTraeProxy() {
  return new Promise((resolve) => {
    if (traeProxyServer) {
      resolve({ success: true, port: traeProxyPort, callbackUrl: `http://127.0.0.1:${traeProxyPort}${TRAE_CONFIG.callbackPath}` });
      return;
    }
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname !== TRAE_CONFIG.callbackPath && url.pathname !== "/auth/callback") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      const session = traeSession;
      if (!session) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderCodexResultPage(false, "No active Trae login session"));
        return;
      }
      if (!isLoopbackOrigin(req.headers.origin)) {
        res.writeHead(403, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderCodexResultPage(false, "Cross-origin callback rejected"));
        return;
      }
      const cbState = url.searchParams.get("state");
      if (cbState && session.state && cbState !== session.state) {
        session.status = "error";
        session.error = "Trae callback state mismatch";
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderCodexResultPage(false, session.error));
        stopTraeProxy();
        return;
      }
      const rawCallback = `${url.pathname}?${url.searchParams.toString()}`;
      try {
        const { exchangeTokens } = await import("../providers.js");
        const { createProviderConnection } = await import("@/models");
        const tokenData = await exchangeTokens("trae", rawCallback);
        const connection = await createProviderConnection({
          provider: "trae",
          authType: "oauth",
          ...tokenData,
          expiresAt: tokenData.expiresIn
            ? new Date(Date.now() + tokenData.expiresIn * 1000).toISOString()
            : null,
          testStatus: "active",
        });
        session.status = "done";
        session.connectionId = connection.id;
        session.email = connection.email;
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderCodexResultPage(true, "You can close this window."));
      } catch (err) {
        session.status = "error";
        session.error = err.message;
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderCodexResultPage(false, err.message));
      } finally {
        stopTraeProxy();
      }
    });
    server.listen(0, "127.0.0.1", () => {
      traeProxyServer = server;
      traeProxyPort = server.address().port;
      traeProxyTimeout = setTimeout(() => stopTraeProxy(), TRAE_CONFIG.oauthTimeoutMs);
      resolve({ success: true, port: traeProxyPort, callbackUrl: `http://127.0.0.1:${traeProxyPort}${TRAE_CONFIG.callbackPath}` });
    });
    server.on("error", (err) => resolve({ success: false, reason: err.message }));
  });
}

export function stopTraeProxy() {
  if (traeProxyTimeout) { clearTimeout(traeProxyTimeout); traeProxyTimeout = null; }
  if (traeProxyServer) { traeProxyServer.close(); traeProxyServer = null; }
  traeProxyPort = null;
}


let windsurfProxyServer = null;
let windsurfProxyTimeout = null;
let windsurfProxyPort = null;
let windsurfSession = null;

export function registerWindsurfSession({ state }) {
  if (!state) return false;
  windsurfSession = { state, status: "pending", createdAt: Date.now() };
  return true;
}
export function getWindsurfSessionStatus(state) {
  if (!windsurfSession) return null;
  if (state && windsurfSession.state !== state) return null;
  return windsurfSession;
}
export function clearWindsurfSession(state) {
  if (!state || (windsurfSession && windsurfSession.state === state)) windsurfSession = null;
}

export function startWindsurfProxy() {
  return new Promise((resolve) => {
    if (windsurfProxyServer) {
      resolve({ success: true, port: windsurfProxyPort, callbackUrl: `http://127.0.0.1:${windsurfProxyPort}${WINDSURF_CONFIG.callbackPath}` });
      return;
    }
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname !== WINDSURF_CONFIG.callbackPath) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      const session = windsurfSession;
      if (!session) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderCodexResultPage(false, "No active Windsurf login session"));
        return;
      }
      if (!isLoopbackOrigin(req.headers.origin)) {
        res.writeHead(403, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderCodexResultPage(false, "Cross-origin callback rejected"));
        return;
      }
      const cbState = url.searchParams.get("state");
      if (!cbState || !session.state || cbState !== session.state) {
        session.status = "error";
        session.error = "Windsurf callback state mismatch";
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderCodexResultPage(false, session.error));
        stopWindsurfProxy();
        return;
      }
      const rawCallback = `${url.pathname}?${url.searchParams.toString()}`;
      try {
        const { exchangeTokens } = await import("../providers.js");
        const { createProviderConnection } = await import("@/models");
        const tokenData = await exchangeTokens("windsurf", rawCallback, null, null, session.state);
        const connection = await createProviderConnection({
          provider: "windsurf",
          authType: "api_key",
          ...tokenData,
          testStatus: "active",
        });
        session.status = "done";
        session.connectionId = connection.id;
        session.email = connection.email;
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderCodexResultPage(true, "You can close this window."));
      } catch (err) {
        session.status = "error";
        session.error = err.message;
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderCodexResultPage(false, err.message));
      } finally {
        stopWindsurfProxy();
      }
    });
    server.listen(0, "127.0.0.1", () => {
      windsurfProxyServer = server;
      windsurfProxyPort = server.address().port;
      windsurfProxyTimeout = setTimeout(() => stopWindsurfProxy(), WINDSURF_CONFIG.oauthTimeoutMs);
      resolve({ success: true, port: windsurfProxyPort, callbackUrl: `http://127.0.0.1:${windsurfProxyPort}${WINDSURF_CONFIG.callbackPath}` });
    });
    server.on("error", (err) => resolve({ success: false, reason: err.message }));
  });
}

export function stopWindsurfProxy() {
  if (windsurfProxyTimeout) { clearTimeout(windsurfProxyTimeout); windsurfProxyTimeout = null; }
  if (windsurfProxyServer) { windsurfProxyServer.close(); windsurfProxyServer = null; }
  windsurfProxyPort = null;
}


let zedProxyServer = null;
let zedProxyTimeout = null;
let zedProxyPort = null;
let zedSession = null;

export function registerZedSession({ state, codeVerifier }) {
  if (!state || !codeVerifier) return false;
  zedSession = { state, codeVerifier, status: "pending", createdAt: Date.now() };
  return true;
}
export function getZedSessionStatus(state) {
  if (!zedSession) return null;
  if (state && zedSession.state !== state) return null;
  return zedSession;
}
export function clearZedSession(state) {
  if (!state || (zedSession && zedSession.state === state)) zedSession = null;
}

export function startZedProxy(preferredPort = 0) {
  return new Promise((resolve) => {
    if (zedProxyServer) {
      resolve({ success: true, port: zedProxyPort, callbackUrl: `http://127.0.0.1:${zedProxyPort}/` });
      return;
    }
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, "http://localhost");
      const redacted = Object.fromEntries(url.searchParams);
      for (const k of ["access_token", "user_id", "code_verifier", "state"]) {
        if (redacted[k]) redacted[k] = "<redacted>";
      }
      console.log("[Zed proxy]", req.method, url.pathname, JSON.stringify(redacted));
      if (url.pathname !== "/" && url.pathname !== "/callback") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      const session = zedSession;
      if (!session) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderCodexResultPage(false, "No active Zed login session"));
        return;
      }
      if (!isLoopbackOrigin(req.headers.origin)) {
        res.writeHead(403, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderCodexResultPage(false, "Cross-origin callback rejected"));
        return;
      }
      const rawCallback = url.search ? `${url.pathname}?${url.searchParams.toString()}` : url.pathname;
      try {
        const { exchangeTokens } = await import("../providers.js");
        const { createProviderConnection } = await import("@/models");
        const tokenData = await exchangeTokens("zed", rawCallback, null, session.codeVerifier, session.state);
        const connection = await createProviderConnection({
          provider: "zed",
          authType: "oauth",
          ...tokenData,
          testStatus: "active",
        });
        session.status = "done";
        session.connectionId = connection.id;
        session.email = connection.email;
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderCodexResultPage(true, "You can close this window."));
      } catch (err) {
        session.status = "error";
        session.error = err.message;
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderCodexResultPage(false, err.message));
      } finally {
        stopZedProxy();
      }
    });
    const tryPort = Number(preferredPort) || 0;
    server.on("error", (err) => {
      if (err.code === "EADDRINUSE" && tryPort !== 0) {
        console.log(`[Zed proxy] port ${tryPort} busy, falling back to random`);
        server.listen(0, "127.0.0.1", () => {
          zedProxyServer = server;
          zedProxyPort = server.address().port;
          zedProxyTimeout = setTimeout(() => stopZedProxy(), ZED_HOSTED_CONFIG.oauthTimeoutMs);
          console.log(`[Zed proxy] listening on random port ${zedProxyPort}`);
          resolve({ success: true, port: zedProxyPort, callbackUrl: `http://127.0.0.1:${zedProxyPort}/` });
        });
      } else {
        console.log(`[Zed proxy] listen error: ${err.message}`);
        resolve({ success: false, reason: err.message });
      }
    });
    server.listen(tryPort, "127.0.0.1", () => {
      zedProxyServer = server;
      zedProxyPort = server.address().port;
      zedProxyTimeout = setTimeout(() => { console.log("[Zed proxy] timeout, stopping"); stopZedProxy(); }, ZED_HOSTED_CONFIG.oauthTimeoutMs);
      console.log(`[Zed proxy] listening on port ${zedProxyPort}`);
      resolve({ success: true, port: zedProxyPort, callbackUrl: `http://127.0.0.1:${zedProxyPort}/` });
    });
  });
}

export function stopZedProxy() {
  console.log(`[Zed proxy] stopping (port ${zedProxyPort || "-"})`);
  if (zedProxyTimeout) { clearTimeout(zedProxyTimeout); zedProxyTimeout = null; }
  if (zedProxyServer) { zedProxyServer.close(); zedProxyServer = null; }
  zedProxyPort = null;
}


let xiaomiMimoProxyServer = null;
let xiaomiMimoProxyPort = null;
let xiaomiMimoProxyTimeout = null;

const xiaomiMimoSessions = new Map();

export function registerXiaomiMimoSession({ state, privateKeyDer }) {
  if (!state || !privateKeyDer) return false;
  xiaomiMimoSessions.set(state, {
    privateKeyDer,
    status: "pending",
    createdAt: Date.now(),
  });
  return true;
}

export function getXiaomiMimoSessionStatus(state) {
  const s = xiaomiMimoSessions.get(state);
  if (!s) return null;
  return { status: s.status, result: s.result || null, error: s.error || null };
}

export function clearXiaomiMimoSession(state) {
  xiaomiMimoSessions.delete(state);
}

function renderXiaomiMimoResultPage(success, message) {
  const color = success ? "#22c55e" : "#ef4444";
  const icon = success ? "&#10003;" : "&#10007;";
  const title = success ? "Authentication Successful" : "Authentication Failed";
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${title}</title>
<style>
  body { font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f5f5f5; }
  .container { text-align: center; padding: 2rem; background: white; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
  .icon { color: ${color}; font-size: 3rem; }
  h1 { margin: 1rem 0; font-size: 1.25rem; }
  p { color: #666; font-size: 0.875rem; }
</style>
</head>
<body>
  <div class="container">
    <div class="icon">${icon}</div>
    <h1>${title}</h1>
    <p>${message || (success ? "You can close this tab and return to Dardcor Code." : "Please try again.")}</p>
    ${success ? "<script>setTimeout(() => window.close(), 3000);</script>" : ""}
  </div>
</body>
</html>`;
}

export function startXiaomiMimoProxy() {
  return new Promise((resolve) => {
    if (xiaomiMimoProxyServer) {
      resolve({
        success: true,
        port: xiaomiMimoProxyPort,
        callbackUrl: `http://127.0.0.1:${xiaomiMimoProxyPort}/`,
      });
      return;
    }

    const server = http.createServer(async (req, res) => {
      if (!isLoopbackOrigin(req.headers.origin)) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }

      const url = new URL(req.url, "http://127.0.0.1");
      const u = url.searchParams.get("u");

      if (!u) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderXiaomiMimoResultPage(false, "Missing encrypted payload (u parameter)."));
        return;
      }

      const pendingSessions = [...xiaomiMimoSessions.entries()]
        .filter(([, s]) => s.status === "pending");

      if (pendingSessions.length === 0) {
        res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderXiaomiMimoResultPage(false, "No active OAuth session. Please restart the login flow."));
        return;
      }

      try {
        const { decryptCallback } = await import("../providers/xiaomi-mimo.js");
        let result = null;
        let matchedState = null;

        for (const [state, session] of pendingSessions) {
          try {
            result = decryptCallback(session.privateKeyDer, u);
            matchedState = state;
            break;
          } catch {
          }
        }

        if (!result || !matchedState) {
          throw new Error("Could not decrypt with any pending session key");
        }

        if (!result.sk) {
          throw new Error("Decrypted payload missing sk (API key)");
        }

        const session = xiaomiMimoSessions.get(matchedState);
        if (session) {
          session.status = "done";
          session.result = {
            uid: result.uid,
            accessToken: result.sk,
            baseUrl: result.url || "https://api.xiaomimimo.com/v1",
          };
        }

        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderXiaomiMimoResultPage(true, "Xiaomi account linked. You can close this tab."));
        console.log("[xiaomi-mimo oauth] callback decrypted, uid:", result.uid);
      } catch (err) {
        console.error("[xiaomi-mimo oauth] decrypt failed:", err.message);
        for (const [, session] of pendingSessions) {
          session.status = "error";
          session.error = err.message;
        }
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderXiaomiMimoResultPage(false, `Decryption failed: ${err.message}`));
      }
    });

    server.on("error", (err) => {
      console.log("[xiaomi-mimo oauth] listen error:", err.message);
      resolve({ success: false, reason: err.message });
    });

    server.listen(0, "127.0.0.1", () => {
      xiaomiMimoProxyServer = server;
      xiaomiMimoProxyPort = server.address().port;
      xiaomiMimoProxyTimeout = setTimeout(() => {
        console.log("[xiaomi-mimo oauth] timeout, stopping");
        stopXiaomiMimoProxy();
      }, 300000);
      console.log(`[xiaomi-mimo oauth] listening on port ${xiaomiMimoProxyPort}`);
      resolve({
        success: true,
        port: xiaomiMimoProxyPort,
        callbackUrl: `http://127.0.0.1:${xiaomiMimoProxyPort}/`,
      });
    });
  });
}

export function stopXiaomiMimoProxy() {
  console.log(`[xiaomi-mimo oauth] stopping (port ${xiaomiMimoProxyPort || "-"})`);
  if (xiaomiMimoProxyTimeout) { clearTimeout(xiaomiMimoProxyTimeout); xiaomiMimoProxyTimeout = null; }
  if (xiaomiMimoProxyServer) { xiaomiMimoProxyServer.close(); xiaomiMimoProxyServer = null; }
  xiaomiMimoProxyPort = null;
  xiaomiMimoSessions.clear();
}

