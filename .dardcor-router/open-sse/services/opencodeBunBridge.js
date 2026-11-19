// Loopback BoringSSL relay for OpenCode Free requests.
// Bun uses BoringSSL which produces the JA4 cipher list hash (5b57614c22b0)
// accepted by opencode.ai's Cloudflare gate.

const PORT = parseInt(process.env.OPENCODE_BUN_BRIDGE_PORT || "25135", 10);

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "content-encoding",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "upgrade"
]);

const server = Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  idleTimeout: 0,
  maxRequestBodySize: 1024 * 1024 * 128,
  async fetch(req) {
    const target = req.headers.get("x-target-url");
    if (!target) {
      return new Response(JSON.stringify({ error: "Missing x-target-url" }), {
        status: 400,
        headers: { "content-type": "application/json" }
      });
    }

    const forwardHeaders = new Headers();
    for (const [k, v] of req.headers.entries()) {
      const lower = k.toLowerCase();
      if (!["x-target-url", "host", "content-length", "x-relay-proxy"].includes(lower)) {
        forwardHeaders.set(k, v);
      }
    }

    const proxy = req.headers.get("x-relay-proxy") || undefined;

    try {
      const upstream = await fetch(target, {
        method: req.method,
        headers: forwardHeaders,
        body: req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined,
        proxy
      });

      const responseHeaders = new Headers();
      for (const [k, v] of upstream.headers.entries()) {
        if (!HOP_BY_HOP.has(k.toLowerCase())) {
          responseHeaders.set(k, v);
        }
      }

      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message || "Upstream fetch failed" }), {
        status: 502,
        headers: { "content-type": "application/json" }
      });
    }
  }
});

console.log(`[OpencodeBunBridge] READY:${server.port}`);
