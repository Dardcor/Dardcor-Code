const http = require("http");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { pathToFileURL } = require("url");

const origCreate = http.createServer.bind(http);

const PEER_TOKEN = crypto.randomBytes(24).toString("hex");
process.env.DARDCORROUTER_PEER_TOKEN = PEER_TOKEN;

const portIdx = process.argv.findIndex((a) => a === "--port" || a === "-p");
if (portIdx !== -1 && process.argv[portIdx + 1]) {
  process.env.PORT = process.argv[portIdx + 1];
}
const hostIdx = process.argv.findIndex((a) => a === "--hostname" || a === "-H");
if (hostIdx !== -1 && process.argv[hostIdx + 1]) {
  process.env.HOSTNAME = process.argv[hostIdx + 1];
}

process.on("uncaughtException", (err) => {
  console.error("[custom-server] Uncaught Exception:", err?.message || err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[custom-server] Unhandled Rejection:", reason?.message || reason);
});

let backgroundRefreshStarted = false;

function startBackgroundTokenRefreshFromCustomServer() {
  if (backgroundRefreshStarted) return;
  backgroundRefreshStarted = true;
  const modPath = path.join(__dirname, "src", "sse", "services", "backgroundTokenRefresh.js");
  import(pathToFileURL(modPath).href)
    .then((m) => {
      try {
        m.startBackgroundTokenRefresh();
      } catch (e) {
        console.error("[BackgroundTokenRefresh] start failed:", e && e.message ? e.message : e);
      }
      const stop = () => {
        try {
          m.stopBackgroundTokenRefresh();
        } catch {
        }
      };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
    })
    .catch((e) => {
      if (process.env.DEBUG_BACKGROUND_TOKEN_REFRESH) {
        console.error("[BackgroundTokenRefresh] import failed:", e && e.message ? e.message : e);
      }
    });
}

http.createServer = (...args) => {
  const handler = args.find((a) => typeof a === "function");
  const rest = args.filter((a) => typeof a !== "function");
  if (!handler) return origCreate(...args);
  const wrapped = (req, res) => {
    const origSetHeader = res.setHeader.bind(res);
    const origAppendHeader = typeof res.appendHeader === "function" ? res.appendHeader.bind(res) : null;
    const origWriteHead = res.writeHead.bind(res);

    function cleanAcao(val) {
      if (typeof val === "string" && val.includes(",")) {
        return "*";
      }
      if (Array.isArray(val)) {
        return "*";
      }
      return val || "*";
    }

    res.setHeader = function (name, value) {
      if (typeof name === "string" && name.toLowerCase() === "access-control-allow-origin") {
        return origSetHeader("Access-Control-Allow-Origin", cleanAcao(value));
      }
      return origSetHeader(name, value);
    };

    if (origAppendHeader) {
      res.appendHeader = function (name, value) {
        if (typeof name === "string" && name.toLowerCase() === "access-control-allow-origin") {
          return origSetHeader("Access-Control-Allow-Origin", cleanAcao(value));
        }
        return origAppendHeader(name, value);
      };
    }

    res.writeHead = function (statusCode, ...rest) {
      origSetHeader("Access-Control-Allow-Origin", "*");
      origSetHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, PATCH, HEAD");
      origSetHeader("Access-Control-Allow-Headers", "*");
      origSetHeader("Access-Control-Allow-Private-Network", "true");
      origSetHeader("Access-Control-Expose-Headers", "*");

      for (let i = 0; i < rest.length; i++) {
        if (rest[i] && typeof rest[i] === "object" && !Array.isArray(rest[i])) {
          const headers = { ...rest[i] };
          for (const key of Object.keys(headers)) {
            if (key.toLowerCase() === "access-control-allow-origin") {
              headers[key] = "*";
            }
          }
          rest[i] = headers;
        }
      }
      return origWriteHead(statusCode, ...rest);
    };

    origSetHeader("Access-Control-Allow-Origin", "*");
    origSetHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, PATCH, HEAD");
    origSetHeader("Access-Control-Allow-Headers", "*");
    origSetHeader("Access-Control-Allow-Private-Network", "true");
    origSetHeader("Access-Control-Expose-Headers", "*");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const socketIp = req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : "";
    const xff = req.headers["x-forwarded-for"];
    const xRealIp = req.headers["x-real-ip"];
    const viaProxy = !!(xff || xRealIp);
    const isLoopbackProxy = socketIp === "127.0.0.1" || socketIp === "::1" || socketIp === "::ffff:127.0.0.1";
    const proxyIp = xRealIp || (xff ? String(xff).split(",")[0].trim() : "");
    const ip = isLoopbackProxy && proxyIp ? proxyIp : socketIp;
    delete req.headers["x-dardcor-real-ip"];
    delete req.headers["x-9r-real-ip"];
    delete req.headers["x-forwarded-for"];
    delete req.headers["x-dardcor-via-proxy"];
    delete req.headers["x-9r-via-proxy"];
    delete req.headers["x-dardcor-peer-token"];
    delete req.headers["x-9r-peer-token"];
    req.headers["x-dardcor-real-ip"] = ip;
    req.headers["x-9r-real-ip"] = ip;
    req.headers["x-dardcor-peer-token"] = PEER_TOKEN;
    req.headers["x-9r-peer-token"] = PEER_TOKEN;
    if (viaProxy) req.headers["x-dardcor-via-proxy"] = "1";
    req.headers["x-9r-via-proxy"] = "1";
    return handler(req, res);
  };
  const server = origCreate(...rest, wrapped);
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
  server.requestTimeout = 300000;
  server.on("connection", (socket) => {
    try {
      socket.setNoDelay(true);
      socket.setKeepAlive(true, 30000);
    } catch {}
  });
  server.once("listening", () => {
    startBackgroundTokenRefreshFromCustomServer();
  });
  const origEmit = server.emit;
  server.emit = function (event, ...eventArgs) {
    const [req, socket, head] = eventArgs;
    if (event !== "upgrade" || String(req.headers.upgrade || "").toLowerCase() !== "h2c") {
      return origEmit.call(this, event, ...eventArgs);
    }

    const contentLength = Number(req.headers["content-length"] || 0);
    if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
      socket.destroy();
      return true;
    }
    const chunks = [head];
    let received = head.length;
    const serve = () => {
      const replay = new http.IncomingMessage(socket);
      Object.assign(replay, { method: req.method, url: req.url, headers: req.headers, complete: true });
      if (received) replay.push(Buffer.concat(chunks, received).subarray(0, contentLength));
      replay.push(null);
      const res = new http.ServerResponse(replay);
      res.shouldKeepAlive = false;
      res.assignSocket(socket);
      res.once("finish", () => socket.end());
      Promise.resolve().then(() => wrapped(replay, res)).catch((error) => {
        console.error("Failed to downgrade h2c request", error);
        socket.destroy();
      });
    };
    if (received >= contentLength) serve();
    else {
      socket.on("data", function readBody(chunk) {
        chunks.push(chunk);
        received += chunk.length;
        if (received < contentLength) return;
        socket.off("data", readBody);
        serve();
      });
      socket.resume();
    }
    delete req.headers.upgrade;
    delete req.headers["http2-settings"];
    req.headers.connection = "close";
    return true;
  };
  return server;
};

if (require.main === module) {
  const standaloneRoot = path.join(__dirname, "server.js");
  const standaloneNext = path.join(__dirname, ".next", "standalone", "server.js");
  const hasLocalNext = fs.existsSync(path.join(__dirname, ".next"));

  if (hasLocalNext && fs.existsSync(standaloneRoot)) {
    require(standaloneRoot);
  } else if (fs.existsSync(standaloneNext)) {
    require(standaloneNext);
  } else if (fs.existsSync(standaloneRoot)) {
    require(standaloneRoot);
  } else {
    const nextBin = require.resolve("next/dist/bin/next");
    process.argv = [process.argv[0], nextBin, "start", ...process.argv.slice(2)];
    require(nextBin);
  }
}

